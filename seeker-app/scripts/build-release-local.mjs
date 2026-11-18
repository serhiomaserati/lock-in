// Local signed release APK, without EAS servers (Windows, Gradle).
// Same inputs as an EAS "preview" build: `expo prebuild` from app.json, then `gradlew assembleRelease`,
// signed with the app's existing EAS key so it installs as an update over EAS builds.
//
// One-time setup (see BUILD_LOCAL.md):
//   - JDK 17 in %USERPROFILE%\.jdks\jdk-17*   (or set LOCKIN_JAVA_HOME)
//   - Android SDK in %LOCALAPPDATA%\Android\Sdk with ndk/27.1.12297006 and cmake/3.22.1 (or set ANDROID_HOME)
//   - node scripts/fetch-eas-keystore.mjs      (puts the key in %USERPROFILE%\.lockin-signing)
//
// Run from seeker-app/:
//   node scripts/build-release-local.mjs                 arm64-v8a (phones) + x86_64 (emulator)
//   LOCKIN_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 node scripts/build-release-local.mjs   all four, like EAS
//   LOCKIN_VERSION_CODE=2 node scripts/build-release-local.mjs                          override versionCode
//   EXPO_PUBLIC_LOCKIN_NETWORK=mainnet EXPO_PUBLIC_LOCKIN_SITE=https://<site> node scripts/build-release-local.mjs
//                                                        mainnet build (real SKR); the env reaches the JS bundle
//
// Output: dist/lock-in-<version>-<commit>[-mainnet].apk (dist/ and *.apk are git-ignored).
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The certificate every Lock-In APK must carry (EAS key; also in website/.well-known/assetlinks.json).
const EXPECTED_CERT_SHA256 = 'e37bd8ee75ade7c4e5dc44b0547f05c180a767a849463c856a156453756dc639'
const NDK_VERSION = '27.1.12297006'

const root = process.cwd()
if (!fs.existsSync(path.join(root, 'app.json'))) throw new Error('Run from seeker-app/')
const home = os.homedir()
const fail = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------- toolchain
const javaHome =
  process.env.LOCKIN_JAVA_HOME ??
  (() => {
    const dir = path.join(home, '.jdks')
    const jdk = fs.existsSync(dir) && fs.readdirSync(dir).find((d) => d.startsWith('jdk-17'))
    return jdk ? path.join(dir, jdk) : null
  })()
if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin', 'java.exe')))
  fail('JDK 17 not found (set LOCKIN_JAVA_HOME).')
const sdk = process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
if (!fs.existsSync(path.join(sdk, 'ndk', NDK_VERSION))) fail(`NDK ${NDK_VERSION} not found in ${sdk}\\ndk.`)
const signingFile = path.join(home, '.lockin-signing', 'signing.properties')
if (!fs.existsSync(signingFile)) fail('Signing key missing: run node scripts/fetch-eas-keystore.mjs')
const signing = Object.fromEntries(
  fs
    .readFileSync(signingFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)

// Windows names it Path; keep a single entry so the JDK goes first without dropping the rest.
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NODE_ENV: 'production',
  [pathKey]: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env[pathKey]}`,
  // Gradle reads ORG_GRADLE_PROJECT_* as project properties: the passwords never touch a file in the repo.
  ORG_GRADLE_PROJECT_lockinStoreFile: signing.storeFile,
  ORG_GRADLE_PROJECT_lockinStorePassword: signing.storePassword,
  ORG_GRADLE_PROJECT_lockinKeyAlias: signing.keyAlias,
  ORG_GRADLE_PROJECT_lockinKeyPassword: signing.keyPassword,
}
const run = (cmd, args, cwd = root) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: true })
  if (r.status !== 0) fail(`${cmd} failed (exit ${r.status})`)
}

// ---------------------------------------------------------------- native project
run('npx', ['expo', 'prebuild', '-p', 'android', '--clean', '--no-install'])

const gradleFile = path.join(root, 'android', 'app', 'build.gradle')
let gradle = fs.readFileSync(gradleFile, 'utf8')
const debugSigning = `        debug {
            storeFile file('debug.keystore')`
if (!gradle.includes(debugSigning)) fail('Unexpected android/app/build.gradle: signingConfigs block not found.')
gradle = gradle.replace(
  debugSigning,
  `        release {
            // Lock-In: the app's EAS key, passed by scripts/build-release-local.mjs.
            storeFile file(findProperty('lockinStoreFile'))
            storePassword findProperty('lockinStorePassword')
            keyAlias findProperty('lockinKeyAlias')
            keyPassword findProperty('lockinKeyPassword')
        }
${debugSigning}`,
)
const releaseSigning = /(release \{\s*\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/
if (!releaseSigning.test(gradle)) fail('Unexpected android/app/build.gradle: release signingConfig not found.')
gradle = gradle.replace(releaseSigning, '$1signingConfig signingConfigs.release')
if (process.env.LOCKIN_VERSION_CODE) {
  gradle = gradle.replace(/versionCode \d+/, `versionCode ${Number(process.env.LOCKIN_VERSION_CODE)}`)
}
fs.writeFileSync(gradleFile, gradle)

const propsFile = path.join(root, 'android', 'gradle.properties')
const props = fs
  .readFileSync(propsFile, 'utf8')
  .replace(/^org\.gradle\.jvmargs=.*$/m, 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m')
  .replace(
    /^reactNativeArchitectures=.*$/m,
    `reactNativeArchitectures=${process.env.LOCKIN_ABIS ?? 'arm64-v8a,x86_64'}`,
  )
fs.writeFileSync(propsFile, props)
fs.writeFileSync(path.join(root, 'android', 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`)

// Native libraries' output folders (…/intermediates/cxx/<variant>/<hash>/obj) hold hard links into the NDK and the
// Gradle cache. On a rebuild Gradle deletes them first, and Windows refuses while another module's linker has the same
// file open (seen with react-native-quick-crypto). They are recreated from the CMake build dirs, so clear them first.
for (const lib of fs.readdirSync(path.join(root, 'node_modules'), { withFileTypes: true })) {
  const dirs = lib.name.startsWith('@')
    ? fs.readdirSync(path.join(root, 'node_modules', lib.name)).map((d) => path.join(lib.name, d))
    : [lib.name]
  for (const d of dirs) {
    const cxx = path.join(root, 'node_modules', d, 'android', 'build', 'intermediates', 'cxx')
    if (!fs.existsSync(cxx)) continue
    for (const variant of fs.readdirSync(cxx)) {
      for (const hash of fs.readdirSync(path.join(cxx, variant))) {
        fs.rmSync(path.join(cxx, variant, hash, 'obj'), { recursive: true, force: true })
      }
    }
  }
}

// ---------------------------------------------------------------- build
const androidDir = path.join(root, 'android')
run(
  `"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`,
  ['assembleRelease', '--no-daemon'],
  androidDir,
)

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!fs.existsSync(built)) fail('app-release.apk was not produced.')

// ---------------------------------------------------------------- verify the signature
const buildTools = fs.readdirSync(path.join(sdk, 'build-tools')).sort().reverse()[0]
const apksigner = path.join(
  sdk,
  'build-tools',
  buildTools,
  process.platform === 'win32' ? 'apksigner.bat' : 'apksigner',
)
const certs = execFileSync(apksigner, ['verify', '--print-certs', built], { env, encoding: 'utf8', shell: true })
const sha = /SHA-256 digest: ([0-9a-f]+)/.exec(certs)?.[1]
if (sha !== EXPECTED_CERT_SHA256) fail(`APK is signed with ${sha}, expected the EAS key ${EXPECTED_CERT_SHA256}.`)

const version = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim() ? '-dirty' : ''
fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
const network = process.env.EXPO_PUBLIC_LOCKIN_NETWORK === 'mainnet' ? '-mainnet' : ''
// Screenshot builds show sample goals (lib/dev/samples.ts): never for the store.
const samples = { 1: '-samples', store: '-storeshots' }[process.env.EXPO_PUBLIC_LOCKIN_SAMPLES] ?? ''
const out = path.join(root, 'dist', `lock-in-${version}-${commit}${dirty}${network}${samples}.apk`)
fs.copyFileSync(built, out)
console.log(`\n✔ Signed with the EAS key (${sha.slice(0, 16)}…)\n✔ ${out}`)
if (samples) console.log('⚠ SAMPLE GOALS BUILD: for screenshots only, NOT for the store.')
