# Code-Signing fuer Windows (kostenlos via SignPath)

Beim Start einer unsignierten `.exe` warnt Windows mit dem blauen
"SmartScreen"-Bildschirm. Fuer Open-Source-Projekte signiert
[SignPath.io](https://signpath.org/free-code-signing-for-open-source) kostenlos.

## Schritte

### 1. Account und Projekt anlegen

1. Auf https://about.signpath.io/registration/open-source registrieren
2. Repository hinzufuegen: `Lutji06/RasiCross-Telemetrie`
3. SignPath erstellt ein "Project" und gibt dir eine `SIGNPATH_API_TOKEN`,
   `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`.

### 2. Secrets in GitHub setzen

Im Repo unter **Settings → Secrets and variables → Actions → New repository secret**
folgende drei Secrets anlegen:

| Name                            | Wert                          |
| ------------------------------- | ----------------------------- |
| `SIGNPATH_API_TOKEN`            | von SignPath                  |
| `SIGNPATH_PROJECT_SLUG`         | von SignPath                  |
| `SIGNPATH_SIGNING_POLICY_SLUG`  | von SignPath (z.B. `release`) |

### 3. Workflow erweitern

In `.github/workflows/build.yml` nach dem Windows-Build-Schritt einfuegen:

```yaml
- name: Submit Windows artifacts to SignPath
  if: runner.os == 'Windows' && startsWith(github.ref, 'refs/tags/')
  uses: signpath/github-action-submit-signing-request@v1
  with:
    api-token: '${{ secrets.SIGNPATH_API_TOKEN }}'
    organization-id: '${{ secrets.SIGNPATH_ORG_ID }}'
    project-slug: '${{ secrets.SIGNPATH_PROJECT_SLUG }}'
    signing-policy-slug: '${{ secrets.SIGNPATH_SIGNING_POLICY_SLUG }}'
    artifact-configuration-slug: 'main'
    github-artifact-id: '${{ steps.upload-windows.outputs.artifact-id }}'
    wait-for-completion: true
    output-artifact-directory: 'dist-signed'
```

Danach verwendet `softprops/action-gh-release` die signierten EXE-Dateien
aus `dist-signed/` statt der unsignierten aus `dist/`.

### 4. Ergebnis

Nach erfolgreicher Einrichtung:
- Build-Pipeline laeuft normal durch
- Vor dem Upload werden die EXE-Dateien automatisch von SignPath signiert
- Endnutzer bekommen **keine SmartScreen-Warnung mehr** beim Start
- Manchmal dauert es ein paar Wochen, bis Microsofts SmartScreen-Reputation
  fuer dein Zertifikat aufgebaut ist — bis dahin gilt "Reputation kommt mit
  Downloads"

## Alternativen

- **Eigenes Code-Signing-Zertifikat kaufen:** ca. 80–250 €/Jahr (Sectigo,
  DigiCert, ssl.com). Lohnt nur fuer kommerzielle Projekte.
- **Einfach unsigniert lassen:** SmartScreen-Warnung dokumentieren (siehe
  README → "Windows-SmartScreen-Hinweis"). Akzeptabel fuer Hobby-Projekte.
