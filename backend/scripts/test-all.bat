@echo off
REM LangGraph Studio 测试启动脚本 (Windows)

echo ========================================
echo LangGraph Studio 测试启动脚本
echo ========================================
echo.

REM 检查端口
echo [1/3] 检查端口 43110...
curl -s http://localhost:43110/info >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] LangGraph Studio 已在运行
    goto :run_tests
)

echo [INFO] LangGraph Studio 未运行，正在启动...
echo.
echo 请在新终端窗口中运行以下命令启动 LangGraph Studio:
echo.
echo   cd backend
echo   npx langgraphjs dev --port 43110
echo.
pause

:run_tests
echo.
echo [2/3] 运行综合测试...
echo.

cd /d "%~dp0.."
node scripts/run-comprehensive-tests.js

echo.
echo [3/3] 测试完成！
echo.
echo 查看报告: docs/langsmith-tests/reports/latest-comprehensive-report.md
echo.

pause
