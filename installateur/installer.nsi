; ============================================================
;  StockInfos — installateur Windows (NSIS, en français)
; ============================================================
Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define APPNAME   "StockInfos"
!define EXENAME   "StockInfos.exe"
!define COMPANY   "StockInfos"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\StockInfos"

Name "${APPNAME}"
OutFile "..\dist\StockInfos-Installation.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${COMPANY}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1036 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de ${APPNAME}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© ${COMPANY}"

!define MUI_ICON   "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "installer-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "installer-side.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "installer-side.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Installation de ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "Cet assistant va installer ${APPNAME} ${VERSION} : la gestion de ton stock et de son planning.$\r$\n$\r$\nTes données ne sont jamais effacées par une mise à jour.$\r$\n$\r$\nClique sur Suivant pour continuer."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "French"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} nécessite une version 64 bits de Windows."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Section "Application" SecApp
  SectionIn RO
  SetShellVarContext current
  ; ferme l'app si elle est ouverte (mise à jour)
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  Sleep 500

  ; remplace proprement l'ancienne version (les données restent dans %APPDATA%)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"

  WriteUninstaller "$INSTDIR\Désinstaller ${APPNAME}.exe"

  ; raccourcis Bureau + menu Démarrer
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0

  ; « Applications installées » de Windows
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKCU "${UNINSTKEY}" "Publisher"       "${COMPANY}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayIcon"     "$INSTDIR\${EXENAME},0"
  WriteRegStr   HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Désinstaller ${APPNAME}.exe"'
  WriteRegStr   HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Désinstaller ${APPNAME}.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 260000
SectionEnd

;  Mise à jour automatique : l'app lance ce programme avec /S /RELANCER
Function .onInstSuccess
  ${If} ${Silent}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/RELANCER" $R1
    ${IfNot} ${Errors}
      Exec '"$INSTDIR\${EXENAME}"'
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  Sleep 500
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; Les données (stock, chantiers, sauvegardes) restent dans
  ; %APPDATA%\StockInfos pour une future réinstallation.
SectionEnd
