; Wipe local Pet Care Clinic data on install/uninstall so each install starts clean.
; Local SQLite lives under %APPDATA%\PetCareClinic (dirs::data_dir).
; Tauri may also write under the bundle identifier.

!macro ClearPetCareLocalData
  RMDir /r "$APPDATA\PetCareClinic"
  RMDir /r "$LOCALAPPDATA\PetCareClinic"
  RMDir /r "$APPDATA\com.petcare.clinic"
  RMDir /r "$LOCALAPPDATA\com.petcare.clinic"
  RMDir /r "$APPDATA\Waleed Pet Care Clinic"
  RMDir /r "$LOCALAPPDATA\Waleed Pet Care Clinic"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ClearPetCareLocalData
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro ClearPetCareLocalData
!macroend
