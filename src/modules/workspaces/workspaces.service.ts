import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workspace } from '../../entities/workspace.entity';
import { WorkspaceMember } from '../../entities/workspace-member.entity';
import { User } from '../../entities/user.entity';
import { generateWorkspaceId } from '../../common/utils/id-generator.util';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto, WorkspaceRole } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ActivitiesService } from '../activities/activities.service';
import { WORKSPACE_ACTIONS, MEMBER_ACTIONS } from '../activities/constants/activity-actions';
import { isSitePublicAnonymousUserId } from '../../common/decorators/public.decorator';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private workspaceMemberRepository: Repository<WorkspaceMember>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activitiesService: ActivitiesService,
  ) {}

  /**
   * 创建工作空间
   */
  async create(createWorkspaceDto: CreateWorkspaceDto, userId: string) {
    // 使用事务确保数据一致性
    const result = await this.dataSource.transaction(async (manager) => {
      const workspace = manager.create(Workspace, {
        workspaceId: generateWorkspaceId(),
        name: createWorkspaceDto.name,
        description: createWorkspaceDto.description,
        icon: createWorkspaceDto.icon,
        ownerId: userId,
        status: 'active',
        settings: {},
      });

      const savedWorkspace = await manager.save(Workspace, workspace);

      // 自动添加创建者为 owner
      const member = manager.create(WorkspaceMember, {
        workspaceId: savedWorkspace.workspaceId,
        userId: userId,
        role: WorkspaceRole.OWNER,
        invitedBy: userId,
      });
      await manager.save(WorkspaceMember, member);

      // 在事务内查询完整的工作空间信息（包括 owner 关系）
      const workspaceWithOwner = await manager.findOne(Workspace, {
        where: { workspaceId: savedWorkspace.workspaceId },
        relations: ['owner'],
      });

      if (!workspaceWithOwner) {
        throw new NotFoundException('工作空间不存在');
      }

      // 返回完整的工作空间信息
      return {
        ...workspaceWithOwner,
        userRole: WorkspaceRole.OWNER,
      };
    });
    await this.activitiesService.record(
      result.workspaceId,
      WORKSPACE_ACTIONS.CREATE,
      'workspace',
      result.workspaceId,
      userId,
      { name: result.name },
    );
    return result;
  }

  /**
   * 获取用户的工作空间列表
   */
  async findAll(userId: string, paginationDto: PaginationDto) {
    const { page = 1, pageSize = 20 } = paginationDto;
    const skip = (page - 1) * pageSize;

    // 查询用户是成员或拥有者的工作空间
    // 使用子查询优化：先找到所有相关的工作空间ID，再查询详情
    const memberWorkspaceIds = await this.workspaceMemberRepository
      .createQueryBuilder('member')
      .select('member.workspaceId', 'workspaceId')
      .where('member.userId = :userId', { userId })
      .getRawMany();

    const memberIds = memberWorkspaceIds.map((m) => m.workspaceId);

    // 构建查询条件
    const queryBuilder = this.workspaceRepository
      .createQueryBuilder('workspace')
      .where('workspace.status = :status', { status: 'active' });

    if (memberIds.length > 0) {
      queryBuilder.andWhere(
        '(workspace.ownerId = :userId OR workspace.workspaceId IN (:...memberIds))',
        { userId, memberIds },
      );
    } else {
      // 如果没有成员记录，只查询拥有者
      queryBuilder.andWhere('workspace.ownerId = :userId', { userId });
    }

    queryBuilder.orderBy('workspace.updatedAt', 'DESC').skip(skip).take(pageSize);

    const [workspaces, total] = await queryBuilder.getManyAndCount();

    // 为每个工作空间添加用户角色信息
    const workspacesWithRole = await Promise.all(
      workspaces.map(async (workspace) => {
        const role = await this.getUserRole(workspace.workspaceId, userId);
        return {
          ...workspace,
          userRole: role,
        };
      }),
    );

    return {
      items: workspacesWithRole,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取工作空间详情
   */
  async findOne(workspaceId: string, userId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
      relations: ['owner'],
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    if (isSitePublicAnonymousUserId(userId)) {
      if (workspace.status !== 'active') {
        throw new NotFoundException('工作空间不存在');
      }

      return {
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        description: workspace.description,
        icon: workspace.icon,
        ownerId: workspace.ownerId,
        status: workspace.status,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      };
    }

    await this.checkAccess(workspaceId, userId);
    const role = await this.getUserRole(workspaceId, userId);

    return {
      ...workspace,
      userRole: role,
    };
  }

  /**
   * ??????
   */
  async update(workspaceId: string, updateWorkspaceDto: UpdateWorkspaceDto, userId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 检查权限：只有 owner 或 admin 可以更新
    const role = await this.getUserRole(workspaceId, userId);
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('只有工作空间所有者或管理员可以更新工作空间');
    }

    // 更新字段
    if (updateWorkspaceDto.name !== undefined) {
      workspace.name = updateWorkspaceDto.name;
    }
    if (updateWorkspaceDto.description !== undefined) {
      workspace.description = updateWorkspaceDto.description;
    }
    if (updateWorkspaceDto.icon !== undefined) {
      workspace.icon = updateWorkspaceDto.icon;
    }
    if (updateWorkspaceDto.status !== undefined) {
      // 只有 owner 可以修改状态
      if (role !== WorkspaceRole.OWNER) {
        throw new ForbiddenException('只有工作空间所有者可以修改工作空间状态');
      }
      workspace.status = updateWorkspaceDto.status;
    }

    await this.workspaceRepository.save(workspace);
    await this.activitiesService.record(
      workspaceId,
      WORKSPACE_ACTIONS.UPDATE,
      'workspace',
      workspaceId,
      userId,
      updateWorkspaceDto as object,
    );
    return this.findOne(workspaceId, userId);
  }

  /**
   * 删除工作空间
   */
  async remove(workspaceId: string, userId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 已删除（archived）视为不存在，避免重复删除与重复记录
    if (workspace.status === 'archived') {
      throw new NotFoundException('工作空间已删除');
    }

    // 只有 owner 可以删除
    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('只有工作空间所有者可以删除工作空间');
    }

    // 软删除：将状态设置为 archived
    workspace.status = 'archived';
    await this.workspaceRepository.save(workspace);
    await this.activitiesService.record(
      workspaceId,
      WORKSPACE_ACTIONS.DELETE,
      'workspace',
      workspaceId,
      userId,
    );
    return { message: '工作空间已删除' };
  }

  /**
   * 邀请成员
   */
  async inviteMember(workspaceId: string, inviteMemberDto: InviteMemberDto, userId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 检查权限：只有 owner 或 admin 可以邀请成员
    const role = await this.getUserRole(workspaceId, userId);
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('只有工作空间所有者或管理员可以邀请成员');
    }

    // 查找用户
    const user = await this.userRepository.findOne({
      where: { email: inviteMemberDto.email },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 检查用户状态
    if (user.status !== 'active') {
      throw new BadRequestException('用户已被禁用，无法邀请');
    }

    // 检查用户是否已经是成员
    const existingMember = await this.workspaceMemberRepository.findOne({
      where: {
        workspaceId,
        userId: user.userId,
      },
    });

    if (existingMember) {
      throw new ConflictException('用户已经是工作空间成员');
    }

    // 不能邀请自己
    if (user.userId === userId) {
      throw new BadRequestException('不能邀请自己');
    }

    // 创建成员记录
    const member = this.workspaceMemberRepository.create({
      workspaceId,
      userId: user.userId,
      role: inviteMemberDto.role,
      invitedBy: userId,
    });

    await this.workspaceMemberRepository.save(member);
    await this.activitiesService.record(
      workspaceId,
      MEMBER_ACTIONS.INVITE,
      'member',
      user.userId,
      userId,
      { email: inviteMemberDto.email, role: inviteMemberDto.role },
    );
    return this.getMemberList(workspaceId, userId);
  }

  /**
   * 获取成员列表
   */
  async getMemberList(workspaceId: string, userId: string) {
    // 检查权限
    await this.checkAccess(workspaceId, userId);

    const members = await this.workspaceMemberRepository.find({
      where: { workspaceId },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });

    // 添加 owner 信息
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
      relations: ['owner'],
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 处理成员列表，确保 user 关系已加载
    const memberList = await Promise.all(
      members.map(async (member) => {
        // 如果 user 关系未加载，尝试单独查询
        let user = member.user;
        if (!user) {
          user = await this.userRepository.findOne({
            where: { userId: member.userId },
          });
        }

        // 如果用户不存在，跳过该成员（可能是数据不一致）
        if (!user) {
          return null;
        }

        return {
          userId: member.userId,
          user: {
            userId: user.userId,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            avatar: user.avatar,
          },
          role: member.role,
          joinedAt: member.joinedAt,
          invitedBy: member.invitedBy || null,
        };
      }),
    );

    // 过滤掉 null 值（用户不存在的成员）
    const validMemberList = memberList.filter(
      (member): member is NonNullable<typeof member> => member !== null,
    );

    // 确保 owner 在列表中
    const ownerInList = validMemberList.find((m) => m.userId === workspace.ownerId);
    if (!ownerInList && workspace.owner) {
      validMemberList.unshift({
        userId: workspace.owner.userId,
        user: {
          userId: workspace.owner.userId,
          username: workspace.owner.username,
          email: workspace.owner.email,
          displayName: workspace.owner.displayName,
          avatar: workspace.owner.avatar,
        },
        role: WorkspaceRole.OWNER,
        joinedAt: workspace.createdAt,
        invitedBy: null,
      });
    }

    return validMemberList;
  }

  /**
   * 更新成员角色
   */
  async updateMemberRole(
    workspaceId: string,
    targetUserId: string,
    updateMemberRoleDto: UpdateMemberRoleDto,
    userId: string,
  ) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 检查权限：只有 owner 或 admin 可以更新成员角色
    const role = await this.getUserRole(workspaceId, userId);
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('只有工作空间所有者或管理员可以更新成员角色');
    }

    // 不能修改 owner 的角色
    if (workspace.ownerId === targetUserId) {
      throw new BadRequestException('不能修改工作空间所有者的角色');
    }

    // 不能将角色设置为 owner（只能通过转移所有权实现）
    if (updateMemberRoleDto.role === WorkspaceRole.OWNER) {
      throw new BadRequestException('不能将角色设置为 owner');
    }

    // 查找成员
    const member = await this.workspaceMemberRepository.findOne({
      where: {
        workspaceId,
        userId: targetUserId,
      },
    });

    if (!member) {
      throw new NotFoundException('成员不存在');
    }

    // 更新角色
    member.role = updateMemberRoleDto.role;
    await this.workspaceMemberRepository.save(member);
    await this.activitiesService.record(
      workspaceId,
      MEMBER_ACTIONS.ROLE,
      'member',
      targetUserId,
      userId,
      { role: updateMemberRoleDto.role },
    );
    return this.getMemberList(workspaceId, userId);
  }

  /**
   * 移除成员
   */
  async removeMember(workspaceId: string, targetUserId: string, userId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    // 检查权限：只有 owner 或 admin 可以移除成员
    const role = await this.getUserRole(workspaceId, userId);
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('只有工作空间所有者或管理员可以移除成员');
    }

    // 不能移除 owner
    if (workspace.ownerId === targetUserId) {
      throw new BadRequestException('不能移除工作空间所有者');
    }

    // 不能移除自己（除非是 owner）
    if (targetUserId === userId && role !== WorkspaceRole.OWNER) {
      throw new BadRequestException('不能移除自己');
    }

    // 删除成员记录
    await this.workspaceMemberRepository.delete({
      workspaceId,
      userId: targetUserId,
    });
    await this.activitiesService.record(
      workspaceId,
      MEMBER_ACTIONS.REMOVE,
      'member',
      targetUserId,
      userId,
    );
    return { message: '成员已移除' };
  }

  /**
   * 获取用户在工作空间中的角色
   */
  async getUserRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      return null;
    }

    // 如果是 owner，直接返回
    if (workspace.ownerId === userId) {
      return WorkspaceRole.OWNER;
    }

    // 查找成员记录
    const member = await this.workspaceMemberRepository.findOne({
      where: {
        workspaceId,
        userId,
      },
    });

    if (!member) {
      return null;
    }

    return member.role as WorkspaceRole;
  }

  /**
   * 检查用户是否有权限访问工作空间
   */
  async checkAccess(workspaceId: string, userId: string): Promise<void> {
    const workspace = await this.workspaceRepository.findOne({
      where: { workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('工作空间不存在');
    }

    const role = await this.getUserRole(workspaceId, userId);
    if (!role) {
      throw new ForbiddenException('您没有权限访问此工作空间');
    }
  }

  /**
   * 检查用户是否有编辑权限（owner、admin、editor）
   */
  async checkEditPermission(workspaceId: string, userId: string): Promise<void> {
    const role = await this.getUserRole(workspaceId, userId);
    if (
      !role ||
      (role !== WorkspaceRole.OWNER &&
        role !== WorkspaceRole.ADMIN &&
        role !== WorkspaceRole.EDITOR)
    ) {
      throw new ForbiddenException('您没有编辑权限');
    }
  }

  /**
   * 检查用户是否有管理权限（owner、admin）
   */
  async checkAdminPermission(workspaceId: string, userId: string): Promise<void> {
    const role = await this.getUserRole(workspaceId, userId);
    if (!role || (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN)) {
      throw new ForbiddenException('您没有管理权限');
    }
  }
}
