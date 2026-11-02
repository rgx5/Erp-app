// Deliberately empty. The app inside the window does not need anything from Node or Electron — it talks to a OneSync
// server over plain HTTPS, exactly as it does from a phone or a browser tab — so nothing is exposed across the
// context-isolation boundary. Keeping contextIsolation on and nodeIntegration off is what makes that safe.
