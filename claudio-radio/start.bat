@echo off
chcp 65001 >nul
echo ========================================
echo   Claudio Radio 启动脚本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查端口 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 发现占用端口的进程: %%a
    echo 正在停止进程...
    taskkill /F /PID %%a >nul 2>&1
    echo 进程已停止
)
echo 端口 3000 已就绪
echo.

echo [2/3] 检查依赖...
if not exist "node_modules" (
    echo 正在安装依赖...
    npm install --cache /tmp/npm-cache
    echo 依赖安装完成
) else (
    echo 依赖已存在
)
echo.

echo [3/3] 启动服务器...
echo.
echo 服务器地址: http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.
node src/index.js
pause
