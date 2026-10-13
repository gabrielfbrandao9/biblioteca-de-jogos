@echo off
rem Atualiza o site com a exportacao mais recente do Playnite e publica no GitHub.
cd /d "%~dp0"
python scripts\build_data.py "D:\Backup\Documentos\HTML Exporter" || goto :erro
git add -A
git commit -m "Atualiza biblioteca de jogos" || echo Nada mudou.
git push || goto :erro
echo.
echo Pronto! O site sera atualizado em 1-2 minutos.
pause
exit /b 0
:erro
echo.
echo Algo deu errado. Veja a mensagem acima.
pause
exit /b 1
