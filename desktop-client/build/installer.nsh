; Wording for the Windows installer's welcome and finish pages (the layout and artwork come from the package.json "nsis" settings).
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to OneSyncERP"
  !define MUI_WELCOMEPAGE_TEXT "This wizard installs OneSyncERP on your computer.$\r$\n$\r$\nClose any other programs first, then click Next to continue."
  !define MUI_FINISHPAGE_TITLE "OneSyncERP is ready"
  !define MUI_FINISHPAGE_TEXT "OneSyncERP has been installed.$\r$\n$\r$\nOn first start you will be asked for your company's server address, which your administrator provides."
!macroend
