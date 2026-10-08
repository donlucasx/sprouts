import { useEvent } from 'expo'
import { Image, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useTheme } from '@/theme'

/** The sign-in sprout (R445: B2, MJ-animated, brand/signin-10-07 mjloop-B2-pxwide-r2): a 5 s loop of the big-leaf sprout swaying in a
 *  breeze, art only (the words are the screen's own text). Light and dark clips are the same frames on each theme's ground
 *  (export_app_video.py). The first frame shows as a still until the video is playing, and stays the only thing shown when the phone
 *  asks for reduced motion. 520 x 420 px painted at 2.625 px/dp. */
const SIZE = { width: 198, height: 160 }
const CLIP = { light: require('../../assets/signin/sprout-light.mp4'), dark: require('../../assets/signin/sprout-dark.mp4') }
const POSTER = { light: require('../../assets/signin/sprout-light.png'), dark: require('../../assets/signin/sprout-dark.png') }

export function SigninSprout() {
  const { dark } = useTheme()
  const still = useReducedMotion()
  const mode = dark ? 'dark' : 'light'
  return (
    <View style={SIZE} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image source={POSTER[mode]} style={SIZE} />
      {/* keyed by theme: a player's source is fixed, so a theme change mounts the other clip */}
      {still ? null : <SproutClip key={mode} source={CLIP[mode]} />}
    </View>
  )
}

function SproutClip({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true
    p.muted = true
    p.audioMixingMode = 'mixWithOthers' // a silent clip must never pause the user's music
    p.play()
  })
  // the clip stays invisible until it is really playing, so the poster never gives way to an empty frame
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing })
  return (
    <VideoView
      player={player}
      style={[SIZE, { position: 'absolute', top: 0, left: 0, opacity: isPlaying ? 1 : 0 }]}
      contentFit="contain"
      nativeControls={false}
      surfaceType="textureView"
      allowsPictureInPicture={false}
    />
  )
}
