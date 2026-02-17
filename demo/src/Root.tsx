import { Composition } from "remotion"
import { DemoVideo } from "./DemoVideo"

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="DemoVideoShort"
        component={DemoVideo}
        defaultProps={{ variant: "short" }}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="DemoVideoFull"
        component={DemoVideo}
        defaultProps={{ variant: "full" }}
        durationInFrames={750}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  )
}
