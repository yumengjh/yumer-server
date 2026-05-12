@echo off
REM ============================================
REM 数据库快速设置脚本 (Windows)
REM ============================================
REM 用途: 自动化数据库初始化流程
REM ============================================

setlocal enabledelayedexpansion

REM 配置变量
set DB_HOST=localhost
set DB_PORT=5432
set DB_USER=postgres
set DB_PASSWORD=postgres
set DB_NAME=knowledge_base

REM 颜色定义 (Windows 10+)
set "INFO=[32mINFO[0m"
set "WARN=[33mWARN[0m"
set "ERROR=[31mERROR[0m"

echo.
echo ======================================
echo 个人知识库系统 - 数据库设置
echo ======================================
echo.

REM 检查 PostgreSQL 是否安装
echo %INFO% 检查 PostgreSQL 安装...
where psql >nul 2>nul
if %errorlevel% neq 0 (
    echo %ERROR% PostgreSQL 未安装，请先安装 PostgreSQL 15+
    pause
    exit /b 1
)

REM 获取 PostgreSQL 版本
for /f "tokens=*" %%i in ('psql --version') do set PSQL_VERSION=%%i
echo %INFO% PostgreSQL 已安装: %PSQL_VERSION%

REM 检查 PostgreSQL 服务是否运行
echo %INFO% 检查 PostgreSQL 服务...
pg_isready -h %DB_HOST% -p %DB_PORT% >nul 2>nul
if %errorlevel% neq 0 (
    echo %ERROR% PostgreSQL 服务未运行，正在尝试启动...
    net start postgresql-x64-15
    timeout /t 3 >nul
    pg_isready -h %DB_HOST% -p %DB_PORT% >nul 2>nul
    if !errorlevel! neq 0 (
        echo %ERROR% 无法启动 PostgreSQL 服务
        pause
        exit /b 1
    )
)
echo %INFO% PostgreSQL 服务正在运行

REM 检查数据库是否存在
echo %INFO% 检查数据库 '%DB_NAME%'...
set PGPASSWORD=%DB_PASSWORD%
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -tAc "SELECT 1 FROM pg_database WHERE datname='%DB_NAME%'" >nul 2>nul
if %errorlevel% equ 0 (
    echo %WARN% 数据库 '%DB_NAME%' 已存在
    set /p REBUILD="是否删除并重建数据库? (y/N): "
    if /i "!REBUILD!"=="y" (
        echo %WARN% 删除数据库 '%DB_NAME%'...
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -c "DROP DATABASE %DB_NAME%;"
        echo %INFO% 创建新数据库 '%DB_NAME%'...
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -c "CREATE DATABASE %DB_NAME%;"
    ) else (
        echo %INFO% 保留现有数据库
    )
) else (
    echo %INFO% 创建数据库 '%DB_NAME%'...
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -c "CREATE DATABASE %DB_NAME%;"
    echo %INFO% 数据库创建成功
)

REM 启用扩展
echo %INFO% 启用 PostgreSQL 扩展...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "CREATE EXTENSION IF NOT EXISTS \"pg_trgm\";"
echo %INFO% 扩展启用成功

REM 创建表结构
echo %INFO% 创建表结构...
if exist "database\schema.sql" (
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f database\schema.sql
    echo %INFO% 表结构创建成功
) else (
    echo %ERROR% 找不到 schema.sql 文件
    pause
    exit /b 1
)

REM 插入种子数据
set /p INSERT_SEED="是否插入测试数据? (y/N): "
if /i "%INSERT_SEED%"=="y" (
    echo %WARN% 插入测试数据（这会清空现有数据）...
    if exist "database\seed.sql" (
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f database\seed.sql
        echo %INFO% 测试数据插入成功
        echo.
        echo %INFO% 测试账户信息:
        echo   管理员: admin@example.com / password123
        echo   用户1:  john@example.com / password123
        echo   用户2:  jane@example.com / password123
        echo   用户3:  bob@example.com / password123
    ) else (
        echo %ERROR% 找不到 seed.sql 文件
        pause
        exit /b 1
    )
) else (
    echo %INFO% 跳过测试数据插入
)

REM 验证安装
echo %INFO% 验证数据库安装...
for /f %%i in ('psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"') do set TABLE_COUNT=%%i
echo %INFO% 创建了 %TABLE_COUNT% 个表

REM 列出所有表
echo %INFO% 数据库表列表:
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "\dt"

REM 显示连接信息
echo.
echo ======================================
echo %INFO% 数据库设置完成！
echo ======================================
echo.
echo %INFO% 数据库连接信息:
echo   Host:     %DB_HOST%
echo   Port:     %DB_PORT%
echo   Database: %DB_NAME%
echo   User:     %DB_USER%
echo.
echo %INFO% 连接命令:
echo   psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME%
echo.
echo %INFO% 下一步: 配置 .env 文件并启动应用
echo.

pause
