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
OutFile "..\dist\StockInfos-Installation-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel admin
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
!define MUI_WELCOMEPAGE_TEXT "Cet assistant va installer ${APPNAME} ${VERSION} : la gestion du stock et du planning des chantiers de ton entreprise.$\r$\n$\r$\nTes données ne sont jamais effacées par une mise à jour.$\r$\n$\r$\nClique sur Suivant pour continuer."
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
  SetShellVarContext all
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
  WriteRegStr   HKLM "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKLM "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKLM "${UNINSTKEY}" "Publisher"       "${COMPANY}"
  WriteRegStr   HKLM "${UNINSTKEY}" "DisplayIcon"     "$INSTDIR\${EXENAME},0"
  WriteRegStr   HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Désinstaller ${APPNAME}.exe"'
  WriteRegStr   HKLM "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Désinstaller ${APPNAME}.exe" /S'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "EstimatedSize" 260000
SectionEnd

;  Mise à jour automatique : l'app lance ce programme avec /S /RELANCER
Function .onInstSuccess
  ${If} ${Silent}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/RELANCER" $R1
    ${IfNot} ${Errors}
      ; relance sans les droits administrateur
      Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXENAME}"'
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  Sleep 500
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
  ; Les données (stock, chantiers, sauvegardes) restent dans
  ; %APPDATA%\StockInfos pour une future réinstallation.
SectionEnd
