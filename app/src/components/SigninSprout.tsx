import { useEvent } from 'expo'
import { useEffect } from 'react'
import { AppState, Image, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useVideoPlayer, VideoView } from 'expo-video'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '@/theme'

/** The sign-in sprout (R445: B2, MJ-animated, brand/signin-10-07 mjloop-B2-pxwide-r2): a 5 s loop of the big-leaf sprout swaying in a
 *  breeze, art only (the words are the screen's own text). Light and dark clips are the same frames on each theme's ground
 *  (export_app_video.py). The first frame shows as a still until the video is playing, and stays the only thing shown when the phone
 *  asks for reduced motion. 560 x 480 px painted at 2.625 px/dp. */
const SIZE = { width: 213, height: 183 }
const CLIP = { light: require('../../assets/signin/sprout-light.mp4'), dark: require('../../assets/signin/sprout-dark.mp4') }
const POSTER = { light: require('../../assets/signin/sprout-light.png'), dark: require('../../assets/signin/sprout-dark.png') }

export function SigninSprout() {
  const { dark, colors } = useTheme()
  const still = useReducedMotion()
  const mode = dark ? 'dark' : 'light'
  return (
    <View style={SIZE} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image source={POSTER[mode]} style={SIZE} />
      {/* keyed by theme: a player's source is fixed, so a theme change mounts the other clip */}
      {still ? null : <SproutClip key={mode} source={CLIP[mode]} />}
      <EdgeFade color={colors.background} />
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
  // Android pauses the player while the app is in the background (the wallet's approval screen): play again on the way back
  // (device 10-08: the sprout stood still after the wallet)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') player.play()
    })
    return () => sub.remove()
  }, [player])
  // Device 10-08 (his note): after a sign-out the sprout stood still. The screen mounts mid-navigation, and the play() in the setup
  // can land before the clip is loaded; play again once it is ready, and whenever it stops while this screen is up.
  const { status } = useEvent(player, 'statusChange', { status: player.status })
  useEffect(() => {
    if (status === 'readyToPlay' && !isPlaying) player.play()
  }, [status, isPlaying, player])
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

/** A 14 dp fade from the screen's ground at each edge of the clip: video colour conversion lands the painted paper 1-3 levels off
 *  the ground (device 10-07: a faint box), and no encoding setting fixed it, so the edge is blended instead. The art sits well
 *  inside the fade. */
const FADE = 14
function EdgeFade({ color }: { color: string }) {
  const { width: w, height: h } = SIZE
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
      <Defs>
        <LinearGradient id="l" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={color} stopOpacity="1" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient>
        <LinearGradient id="r" x1="1" y1="0" x2="0" y2="0"><Stop offset="0" stopColor={color} stopOpacity="1" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient>
        <LinearGradient id="t" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity="1" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient>
        <LinearGradient id="b" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor={color} stopOpacity="1" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={FADE} height={h} fill="url(#l)" />
      <Rect x={w - FADE} y={0} width={FADE} height={h} fill="url(#r)" />
      <Rect x={0} y={0} width={w} height={FADE} fill="url(#t)" />
      <Rect x={0} y={h - FADE} width={w} height={FADE} fill="url(#b)" />
    </Svg>
  )
}
