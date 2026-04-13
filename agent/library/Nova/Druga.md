Allow User Abort [ Off ]
Set Error Capture [ On ]
#
Set Variable [ $companyID ]
Set Variable [ $datumOd ]
Set Variable [ $datumDo ]
Set Variable [ $void ; Value: jsonToVars ( Get ( ScriptParameter ) ; "local" ) ]
Set Variable [ $errors ; Value: "[]" ]
Set Variable [ $rows ; Value: "[]" ]
Set Variable [ $exit ; Value: False ]
#
# Validate input
If [ IsEmpty ( $companyID ) ]
	Set Variable [ $errors ; Value: JSONSetElement ( $errors ; "[+]" ; "Nedostaje companyID" ; JSONString ) ]
	Set Variable [ $exit ; Value: True ]
End If

If [ IsEmpty ( $datumOd ) ]
	Set Variable [ $errors ; Value: JSONSetElement ( $errors ; "[+]" ; "Nedostaje datumOd" ; JSONString ) ]
	Set Variable [ $exit ; Value: True ]
End If

If [ IsEmpty ( $datumDo ) ]
	Set Variable [ $errors ; Value: JSONSetElement ( $errors ; "[+]" ; "Nedostaje datumDo" ; JSONString ) ]
	Set Variable [ $exit ; Value: True ]
End If

If [ not $exit and GetAsDate ( $datumOd ) > GetAsDate ( $datumDo ) ]
	Set Variable [ $errors ; Value: JSONSetElement ( $errors ; "[+]" ; "datumOd ne može biti veći od datumDo" ; JSONString ) ]
	Set Variable [ $exit ; Value: True ]
End If

If [ $exit ]
	Exit Script [ Text Result: JSONSetElement ( "{}" ;
		[ "status" ; "fail" ; JSONString ] ;
		[ "rows" ; $rows ; JSONArray ] ;
		[ "errors" ; $errors ; JSONArray ]
	) ]
End If
#
# Find posted kalkulacije in period
Go to Layout [ “KMP__KalkulacijaMP” (KMP__KalkulacijaMP) ; Animation: None ]
Enter Find Mode [ Pause: Off ]
Set Field [ KMP__KalkulacijaMP::ForeignKeyCompanyID ; $companyID ]
Set Field [ KMP__KalkulacijaMP::Status ; "Knjižena" ]
Set Field [ KMP__KalkulacijaMP::DatumKalkulacije ; GetAsDate ( $datumOd ) & "..." & GetAsDate ( $datumDo ) ]
Perform Find []
#
If [ Get ( LastError ) ≠ 0 or Get ( FoundCount ) = 0 ]
	Exit Script [ Text Result: JSONSetElement ( "{}" ;
		[ "status" ; "success" ; JSONString ] ;
		[ "rows" ; $rows ; JSONArray ] ;
		[ "errors" ; $errors ; JSONArray ]
	) ]
End If
#
Go to Record/Request/Page [ First ]
Loop [ Flush: Always ]
	Set Variable [ $row ; Value: JSONSetElement ( "{}" ;
		[ "datum" ; KMP__KalkulacijaMP::DatumKalkulacije ; JSONString ] ;
		[ "opis" ; "Kalkulacija MP " & KMP__KalkulacijaMP::BrojKalkulacije ; JSONString ] ;
		[ "brojDokumenta" ; KMP__KalkulacijaMP::BrojKalkulacije ; JSONString ] ;
		[ "zaduzenje" ; GetAsNumber ( KMP__KalkulacijaMP::UkupnoMP_Roba ) ; JSONNumber ] ;
		[ "razduzenje" ; 0 ; JSONNumber ] ;
		[ "tip" ; "KalkulacijaMP" ; JSONString ] ;
		[ "sortDatum" ; KMP__KalkulacijaMP::DatumKalkulacije ; JSONString ] ;
		[ "sortOrder" ; 1 ; JSONNumber ] ;
		[ "documentID" ; KMP__KalkulacijaMP::PrimaryKey ; JSONString ]
	) ]
	
	Set Variable [ $rows ; Value: JSONSetElement ( $rows ; "[+]" ; $row ; JSONObject ) ]
	Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop
#
Exit Script [ Text Result: JSONSetElement ( "{}" ;
	[ "status" ; "success" ; JSONString ] ;
	[ "rows" ; $rows ; JSONArray ] ;
	[ "errors" ; $errors ; JSONArray ]
) ]
