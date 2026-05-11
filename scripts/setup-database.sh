#!/bin/bash

# ============================================
# 数据库快速设置脚本
# ============================================
# 用途: 自动化数据库初始化流程
# ============================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置变量
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USERNAME:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_NAME=${DB_DATABASE:-knowledge_base}

# 函数：打印信息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 函数：检查 PostgreSQL 是否安装
check_postgres() {
    print_info "检查 PostgreSQL 安装..."
    if command -v psql &> /dev/null; then
        print_info "PostgreSQL 已安装: $(psql --version)"
        return 0
    else
        print_error "PostgreSQL 未安装，请先安装 PostgreSQL 15+"
        exit 1
    fi
}

# 函数：检查 PostgreSQL 是否运行
check_postgres_running() {
    print_info "检查 PostgreSQL 服务..."
    if pg_isready -h $DB_HOST -p $DB_PORT &> /dev/null; then
        print_info "PostgreSQL 服务正在运行"
        return 0
    else
        print_error "PostgreSQL 服务未运行，请启动服务"
        exit 1
    fi
}

# 函数：创建数据库
create_database() {
    print_info "创建数据库 '$DB_NAME'..."
    
    # 检查数据库是否已存在
    DB_EXISTS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")
    
    if [ "$DB_EXISTS" = "1" ]; then
        print_warning "数据库 '$DB_NAME' 已存在"
        read -p "是否删除并重建数据库? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_warning "删除数据库 '$DB_NAME'..."
            PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "DROP DATABASE $DB_NAME;"
            print_info "创建新数据库 '$DB_NAME'..."
            PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME;"
        else
            print_info "保留现有数据库"
        fi
    else
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME;"
        print_info "数据库创建成功"
    fi
}

# 函数：启用扩展
enable_extensions() {
    print_info "启用 PostgreSQL 扩展..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
EOF
    print_info "扩展启用成功"
}

# 函数：创建表结构
create_schema() {
    print_info "创建表结构..."
    
    if [ -f "database/schema.sql" ]; then
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f database/schema.sql
        print_info "表结构创建成功"
    else
        print_error "找不到 schema.sql 文件"
        exit 1
    fi
}

# 函数：插入种子数据
insert_seed_data() {
    read -p "是否插入测试数据? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_warning "插入测试数据（这会清空现有数据）..."
        
        if [ -f "database/seed.sql" ]; then
            PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f database/seed.sql
            print_info "测试数据插入成功"
            echo ""
            print_info "测试账户信息:"
            echo "  管理员: admin@example.com / password123"
            echo "  用户1:  john@example.com / password123"
            echo "  用户2:  jane@example.com / password123"
            echo "  用户3:  bob@example.com / password123"
        else
            print_error "找不到 seed.sql 文件"
            exit 1
        fi
    else
        print_info "跳过测试数据插入"
    fi
}

# 函数：验证安装
verify_installation() {
    print_info "验证数据库安装..."
    
    TABLE_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
    
    print_info "创建了 $TABLE_COUNT 个表"
    
    # 列出所有表
    print_info "数据库表列表:"
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "\dt"
}

# 函数：显示连接信息
show_connection_info() {
    echo ""
    print_info "======================================"
    print_info "数据库设置完成！"
    print_info "======================================"
    echo ""
    print_info "数据库连接信息:"
    echo "  Host:     $DB_HOST"
    echo "  Port:     $DB_PORT"
    echo "  Database: $DB_NAME"
    echo "  User:     $DB_USER"
    echo ""
    print_info "连接命令:"
    echo "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
    echo ""
    print_info "下一步: 配置 .env 文件并启动应用"
    echo ""
}

# 主函数
main() {
    echo ""
    print_info "======================================"
    print_info "个人知识库系统 - 数据库设置"
    print_info "======================================"
    echo ""
    
    # 执行步骤
    check_postgres
    check_postgres_running
    create_database
    enable_extensions
    create_schema
    insert_seed_data
    verify_installation
    show_connection_info
}

# 运行主函数
main
