// Downloads the app's existing EAS Android signing key for local release builds.
// It uses your Expo login (~/.expo/state.json, from `npx eas-cli login`) and the same GraphQL query as
// `eas credentials`. Nothing is printed except the certificate fingerprint.
//
// Output (outside the repo, never commit it):
//   %USERPROFILE%\.lockin-signing\lockin-release.jks
//   %USERPROFILE%\.lockin-signing\signing.properties
//
// Run: node scripts/fetch-eas-keystore.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT = '@drugdealer/lock-in'
const PACKAGE = 'app.lockin.mobile'
const OUT = path.join(os.homedir(), '.lockin-signing')

const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.expo', 'state.json'), 'utf8'))
const session = state.auth?.sessionSecret
if (!session) throw new Error('Not logged in to Expo. Run: npx eas-cli login')

const query = `
  query ($projectFullName: String!, $applicationIdentifier: String) {
    app {
      byFullName(fullName: $projectFullName) {
        androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier }) {
          androidAppBuildCredentialsList {
            name
            isDefault
            androidKeystore { keystore keystorePassword keyAlias keyPassword sha256CertificateFingerprint }
          }
        }
      }
    }
  }`

const res = await fetch('https://api.expo.dev/graphql', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'expo-session': session },
  body: JSON.stringify({ query, variables: { projectFullName: PROJECT, applicationIdentifier: PACKAGE } }),
})
const body = await res.json()
if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '))
const list = body.data.app.byFullName.androidAppCredentials?.[0]?.androidAppBuildCredentialsList ?? []
const creds = list.find((c) => c.isDefault) ?? list[0]
const ks = creds?.androidKeystore
if (!ks) throw new Error(`No Android keystore on EAS for ${PACKAGE}`)

fs.mkdirSync(OUT, { recursive: true })
const jks = path.join(OUT, 'lockin-release.jks')
fs.writeFileSync(jks, Buffer.from(ks.keystore, 'base64'))
fs.writeFileSync(
  path.join(OUT, 'signing.properties'),
  [
    `storeFile=${jks.replace(/\\/g, '/')}`,
    `storePassword=${ks.keystorePassword}`,
    `keyAlias=${ks.keyAlias}`,
    `keyPassword=${ks.keyPassword}`,
    '',
  ].join('\n'),
)
console.log(`Saved the EAS key "${creds.name ?? 'default'}" to ${OUT}`)
console.log(`SHA-256 certificate fingerprint: ${ks.sha256CertificateFingerprint}`)
