import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { colors } from './theme'

/**
 * The Lock-In padlock (same shape as the app icon). `open` lifts the shackle (deposit returned);
 * `check` puts a tick on the body instead of the keyhole.
 */
export function Padlock({
  size = 20,
  color = colors.accent,
  cutout = colors.bg,
  open = false,
  check = false,
}: {
  size?: number
  color?: string
  cutout?: string
  open?: boolean
  check?: boolean
}) {
  return (
    <Svg width={size} height={size} viewBox="270 230 484 600">
      <Path
        d={open ? 'M396 470 V340 A116 116 0 0 1 628 340 V360' : 'M396 470 V398 A116 116 0 0 1 628 398 V470'}
        fill="none"
        stroke={color}
        strokeWidth={76}
        strokeLinecap={open ? 'round' : 'butt'}
      />
      <Rect x={292} y={452} width={440} height={356} rx={76} fill={color} />
      {check ? (
        <Path
          d="M420 630 L490 700 L612 575"
          fill="none"
          stroke={cutout}
          strokeWidth={56}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <Circle cx={512} cy={606} r={46} fill={cutout} />
          <Rect x={490} y={620} width={44} height={100} rx={22} fill={cutout} />
        </>
      )}
    </Svg>
  )
}
