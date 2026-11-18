import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { AppText } from '@/components/app-text'
import { useCluster } from '@/components/cluster/cluster-provider'
import { clockOffset, now, resetClock, shiftClock } from '@/lib/dev/clock'
import { devForgetDeviceKey } from '@/lib/chain/device-key'
import { buildDemoPledges } from '@/lib/dev/demo-pledges'
import { SAMPLES_ENABLED, STORE_SHOTS } from '@/lib/dev/samples'
import { DAY_MS, isDemoPledge } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'

const H = 60 * 60 * 1000

/** Dev builds only: move the app clock and load pledges in every state. */
export function DevPanel() {
  const { account } = useMobileWallet()
  const { pledges, devReplacePledges, clockTick } = usePledges()
  // Sample goals go next to the real ones (a real goal's local record must survive testing).
  const real = pledges.filter((p) => !isDemoPledge(p))
  const { selectedCluster } = useCluster()
  if (!SAMPLES_ENABLED) return null

  const offsetH = Math.round(clockOffset() / H)
  const owner = account?.address?.toString() ?? 'demo'

  return (
    <View style={styles.panel} key={clockTick}>
      <AppText type="defaultSemiBold">Developer (debug build only)</AppText>
      <AppText style={styles.meta}>
        App time: {new Date(now()).toString().slice(0, 21)}
        {offsetH !== 0 ? `  (+${offsetH}h)` : '  (real)'}
      </AppText>
      <AppText style={styles.meta}>
        Network: {selectedCluster.name} · {selectedCluster.endpoint}
      </AppText>
      <View style={styles.row}>
        <DevButton label="+1 hour" onPress={() => shiftClock(H)} />
        <DevButton label="+1 day" onPress={() => shiftClock(DAY_MS)} />
        <DevButton label="+1 week" onPress={() => shiftClock(7 * DAY_MS)} />
        <DevButton label="Reset clock" onPress={resetClock} />
      </View>
      <View style={styles.row}>
        <DevButton
          label="Add sample goals"
          onPress={() => devReplacePledges([...real, ...buildDemoPledges(owner, now())])}
        />
        {/* Store shot builds add the curated set above; the website shots also need the pending and lost states. */}
        {STORE_SHOTS && (
          <DevButton
            label="Add every sample state"
            onPress={() => devReplacePledges([...real, ...buildDemoPledges(owner, now(), true)])}
          />
        )}
        <DevButton label="Remove sample goals" onPress={() => devReplacePledges(real)} />
        {/* Like an uninstall, but keeps the wallet session (the test wallet makes a new account on every fresh connect). */}
        <DevButton
          label="Simulate reinstall"
          onPress={async () => {
            if (owner) await devForgetDeviceKey(owner)
            await devReplacePledges([])
          }}
        />
      </View>
    </View>
  )
}

function DevButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <AppText style={{ fontSize: 13, fontWeight: '600' }}>{label}</AppText>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  panel: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D97706' },
  meta: { fontSize: 13, opacity: 0.7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(217,119,6,0.12)' },
})
