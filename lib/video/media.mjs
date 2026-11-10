import {execute as executeProcess} from './process.mjs';
import {stat} from 'node:fs/promises';
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, isAbsolute } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
class VideoMedia {
  constructor(settings, signal) {
    this.settings = settings;
    this.signal = signal;
  }
  settings;
  signal;
  async binary(probe = false) {
    const configured = (await this.settings()).ffmpegPath?.trim() || process.env.VANT_FFMPEG?.trim();
    if (!configured) return probe ? "ffprobe" : "ffmpeg";
    if (!isAbsolute(configured))
      throw new Error("FFmpeg 路径必须是可执行文件的绝对路径");
    return probe ? join(
      dirname(configured),
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
    ) : configured;
  }
  async run(args, probe = false) {
    try {
      return await executeProcess(await this.binary(probe),args,{signal:this.signal,timeoutMs:600000,maxOutputChars:4*1024*1024});
    } catch (e) {
      const error = e;
      if (this.signal.aborted) throw new Error("视频处理已中断");
      throw new Error(
        error.code === "ENOENT" ? "未找到 FFmpeg / ffprobe，请在视频设置中配置剪辑工具路径" : `视频处理失败：${(error.stderr || error.message).slice(-2e3)}`
      );
    }
  }
  async status() {
    try {
      await Promise.all([this.run(["-version"]), this.run(["-version"], true)]);
      return { available: true, reason: "" };
    } catch (e) {
      return { available: false, reason: e.message };
    }
  }
  async probe(path) {
    const { stdout } = await this.run(
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      true
    );
    const data = JSON.parse(stdout), v = data.streams?.find((s) => s.codec_type === "video");
    const fraction = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
    const info = {
      duration: Number(data.format?.duration ?? v?.duration),
      fps: fraction[0] / fraction[1],
      width: Number(v?.width),
      height: Number(v?.height),
      audio: !!data.streams?.some((s) => s.codec_type === "audio"),
      videoDuration: Number(v?.duration ?? data.format?.duration),
      frames: Number(v?.nb_frames) || undefined
    };
    if (!v || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 7200 || !Number.isFinite(info.fps) || info.fps <= 0 || info.fps > 240 || !info.width || !info.height || info.width > 8192 || info.height > 8192)
      throw new Error("视频时长、帧率或尺寸无效");
    return info;
  }
  async frame(path, time, directory) {
    const info = await this.probe(path);
    if (!Number.isFinite(time) || time < 0 || time >= info.duration)
      throw new Error("取帧位置超出视频范围");
    const finalFrame = Number.isInteger(info.frames) && info.frames > 0 ? (info.frames - 1) / info.fps : Math.max(0, info.videoDuration - 1 / info.fps);
    const safeTime = Math.min(time, finalFrame);
    const output = join(directory, `${randomUUID()}.png`);
    await mkdir(directory, { recursive: true });
    try {
      await this.run([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        String(safeTime),
        "-i",
        path,
        "-frames:v",
        "1",
        "-threads",
        "1",
        output
      ]);
      return await readFile(output);
    } finally {
      await rm(output, { force: true });
    }
  }
  async render(parts, output, profile, keepAudioFrom) {
    if (!parts.length || parts.length > 128)
      throw new Error("拼接片段数量应为 1–128");
    const fps = profile.fps, width = profile.width + profile.width % 2, height = profile.height + profile.height % 2;
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-filter_complex_threads",
      "1"
    ];
    const filters = [];
    let duration = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], info = await this.probe(p.path);
      const sourceDuration = p.sourceDuration ?? p.duration, speed = sourceDuration / p.duration;
      if (!Number.isFinite(p.start) || !Number.isFinite(p.duration) || !Number.isFinite(sourceDuration) || p.start < 0 || p.duration <= 0 || sourceDuration <= 0 || p.start + sourceDuration > info.duration + 1 / info.fps)
        throw new Error("片段区间或调整速度超出范围");
      args.push("-i", p.path);
      let remaining = speed;
      const tempo = [];
      while (remaining > 2) {
        tempo.push("atempo=2");
        remaining /= 2;
      }
      while (remaining < 0.5) {
        tempo.push("atempo=0.5");
        remaining *= 2;
      }
      tempo.push(`atempo=${remaining}`);
      filters.push(
        `[${i}:v:0]trim=start=${p.start}:duration=${sourceDuration},setpts=(PTS-STARTPTS)/${speed},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,settb=AVTB[v${i}]`
      );
      if (info.audio)
        filters.push(
          `[${i}:a:0]atrim=start=${p.start}:duration=${sourceDuration},asetpts=PTS-STARTPTS,${tempo.join(",")},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${p.duration}[a${i}]`
        );
      else
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${p.duration},asetpts=PTS-STARTPTS[a${i}]`
        );
    }
    let v = "v0", a = "a0";
    duration = parts[0].duration;
    for (let i = 1; i < parts.length; i++) {
      const transition = parts[i - 1].transition;
      if (transition?.type === "dissolve") {
        const overlap = transition.duration;
        if (overlap <= 0 || overlap >= Math.min(parts[i - 1].duration, parts[i].duration))
          throw new Error("叠化时长超出相邻片段范围");
        filters.push(
          `[${v}]fps=${fps},settb=AVTB[fixed${i}]`,
          `[fixed${i}][v${i}]xfade=transition=fade:duration=${overlap}:offset=${duration - overlap}[cv${i}]`,
          `[${a}][a${i}]acrossfade=d=${overlap}[ca${i}]`
        );
        duration += parts[i].duration - overlap;
      } else {
        filters.push(
          `[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[cv${i}][ca${i}]`
        );
        duration += parts[i].duration;
      }
      v = `cv${i}`;
      a = `ca${i}`;
    }
    if (keepAudioFrom) {
      const audio = await this.probe(keepAudioFrom);
      filters.push(`[${a}]anullsink`);
      if (audio.audio) {
        args.push("-i", keepAudioFrom);
        filters.push(
          `[${parts.length}:a:0]atrim=duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=duration=${duration}[originalAudio]`
        );
      } else
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[originalAudio]`
        );
      a = "originalAudio";
    }
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${v}]`,
      "-map",
      `[${a}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
      "-r",
      String(fps),
      "-fps_mode",
      "cfr",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      output
    );
    await mkdir(dirname(output), { recursive: true });
    try {
      await this.run(args);
      if((await stat(output)).size>512*1024*1024)throw new Error("视频超过 512 MiB 上限");
      const result = await this.probe(output);
      if (Math.abs(result.duration - duration) > Math.max(0.15, 2 / fps))
        throw new Error("处理后的视频时长与剪辑计划不一致");
      return result;
    } catch (e) {
      await rm(output, { force: true });
      throw e;
    }
  }
}
export {
  VideoMedia
};
