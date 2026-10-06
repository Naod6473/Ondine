; Petits ajouts à l'installateur d'Ondine (NSIS, généré par Tauri).
;
; Après l'installation, on note la langue choisie dans l'installateur
; ($LANGUAGE : 1036 = français, 1033 = anglais) dans le registre de
; l'utilisateur. Au premier lancement, la langue « automatique » d'Ondine la
; reprend (voir platform::system_language). Rien d'autre n'est écrit.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Ondine" "InstallLanguage" "$LANGUAGE"
!macroend

; À la désinstallation, on retire cette petite clé.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Ondine"
!macroend
