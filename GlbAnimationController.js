/**
 * Three.js R146 GLB多动画控制器【增强版】
 * 新增：获取当前时间/帧、播放结束回调事件、状态查询API
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class GlbAnimationController {
  /**
   * @param {THREE.Scene} scene three场景
   */
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();

    this.gltf = null;
    this.model = null;
    this.animator = null; // AnimationMixer
    this.clipsMap = new Map(); // key:动画名 value:AnimationClip
    this.activeActions = new Map(); // key:动画名 value:AnimationAction

    this.globalTimeScale = 1.0;
    this.isPaused = false;

    // 事件回调
    this._eventCallbacks = {
      /** 动画单次播放完成回调 (animName:string)=>{} */
      onAnimationEnd: null,
      /** 片段播放完成回调 (animName:string)=>{} */
      onSegmentEnd: null
    };

    // mixer事件监听
    this._onMixerFinished = this._handleMixerFinished.bind(this);
  }

  /**
   * 加载GLB模型，选择需要使用的动画名称数组
   * @param {string} url glb路径
   * @param {string[]} includeAnimNames 需要加载的动画名称，[]代表全部加载
   * @returns {Promise<{model:THREE.Object3D, clips:AnimationClip[]}>}
   */
  loadModel(url, includeAnimNames = []) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          this.gltf = gltf;
          this.model = gltf.scene;
          this.scene.add(this.model);

          this.animator = new THREE.AnimationMixer(this.model);
          // 绑定mixer finish事件
          this.animator.addEventListener('finished', this._onMixerFinished);

          this.clipsMap.clear();
          this.activeActions.clear();

          const allClips = gltf.animations || [];
          let useClips = [];
          if (includeAnimNames.length > 0) {
            useClips = allClips.filter((clip) => includeAnimNames.includes(clip.name));
          } else {
            useClips = [...allClips];
          }

          useClips.forEach((clip) => {
            this.clipsMap.set(clip.name, clip);
          });

          resolve({
            model: this.model,
            clips: useClips
          });
        },
        () => { },
        (err) => reject(err)
      );
    });
  }

  /**
   * 设置事件监听
   * @param {'onAnimationEnd'|'onSegmentEnd'} eventName
   * @param {Function} callback
   */
  on(eventName, callback) {
    if (this._eventCallbacks.hasOwnProperty(eventName)) {
      this._eventCallbacks[eventName] = callback;
    }
  }

  /**
   * 内部：mixer播放完成事件处理
   * @param {THREE.Event} e
   */
  _handleMixerFinished(e) {
    const action = e.action;
    if (!action || !action._clip) return;
    const clipName = action._clip.name;

    // 判断是片段clip还是原始clip
    if (clipName.includes('_seg_')) {
      if (typeof this._eventCallbacks.onSegmentEnd === 'function') {
        this._eventCallbacks.onSegmentEnd(clipName.replace(/_seg_.*/, ''));
      }
    } else {
      if (typeof this._eventCallbacks.onAnimationEnd === 'function') {
        this._eventCallbacks.onAnimationEnd(clipName);
      }
    }
  }

  /**
   * 获取所有可用动画名称列表
   * @returns {string[]}
   */
  getClipNames() {
    return Array.from(this.clipsMap.keys());
  }

  /**
   * 获取clip总时长(秒)
   * @param {string} animName
   * @returns {number}
   */
  getClipDuration(animName) {
    const clip = this.clipsMap.get(animName);
    if (!clip) return 0;
    return clip.duration;
  }

  /**
   * 获取指定动画的总帧数（按默认帧率30fps）
   * @param {string} animName
   * @param {number} fps 默认30
   * @returns {number}
   */
  getClipTotalFrames(animName, fps = 30) {
    const dur = this.getClipDuration(animName);
    return Math.floor(dur * fps);
  }

  /**
   * 获取【当前正在播放动画】的当前时间（秒）
   * @param {string} animName
   * @returns {number}
   */
  getCurrentTime(animName) {
    const act = this.activeActions.get(animName);
    if (!act) return 0;
    return act.time;
  }

  /**
   * 获取【当前正在播放动画】当前帧
   * @param {string} animName
   * @param {number} fps 默认30
   * @returns {number}
   */
  getCurrentFrame(animName, fps = 30) {
    return Math.floor(this.getCurrentTime(animName) * fps);
  }

  /**
   * 获取动画状态对象
   * @param {string} animName
   * @returns {{playing:boolean,paused:boolean,currentTime:number,currentFrame:number,duration:number}}
   */
  getAnimState(animName) {
    const act = this.activeActions.get(animName);
    if (!act) {
      return { playing: false, paused: false, currentTime: 0, currentFrame: 0, duration: 0 };
    }
    const dur = this.getClipDuration(animName);
    const curTime = act.time;
    const curFrame = Math.floor(curTime * 30);
    return {
      playing: act.isRunning(),
      paused: act.paused,
      currentTime: curTime,
      currentFrame: curFrame,
      duration: dur
    };
  }

  /**
   * 播放完整动画
   * @param {string} animName
   * @param {boolean} loop 是否循环
   * @param {number} timeScale 播放速度，负数倒放
   */
  playFull(animName, loop = false, timeScale = 1.0) {
    if (!this.animator) return;
    const clip = this.clipsMap.get(animName);
    if (!clip) {
      console.warn(`不存在动画:${animName}`);
      return;
    }

    this._stopAction(animName);

    const action = this.animator.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    action.play();

    this.activeActions.set(animName, action);
    this.isPaused = false;
  }

  /**
   * 播放动画的指定时间段 [startSec ~ endSec]
   * @param {string} animName 动画名称
   * @param {number} startSec 起始时间 秒
   * @param {number} endSec 结束时间 秒
   * @param {boolean} loop 是否循环片段
   * @param {number} timeScale 速度，负数倒放
   */
  playSegment(animName, startSec, endSec, loop = false, timeScale = 1.0) {
    if (!this.animator) return;
    const srcClip = this.clipsMap.get(animName);
    if (!srcClip) {
      console.warn(`不存在动画:${animName}`);
      return;
    }
    const dur = srcClip.duration;
    startSec = Math.max(0, startSec);
    endSec = Math.min(dur, endSec);
    if (startSec >= endSec) return;

    this._stopAction(animName);

    // 克隆片段，标记片段名称，用于区分结束事件
    const segClip = srcClip.clone();
    segClip.name = `${animName}_seg_${Date.now()}`;
    segClip.trim(startSec, endSec);

    const action = this.animator.clipAction(segClip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    action.play();

    this.activeActions.set(animName, action);
    this.isPaused = false;
  }

  /**
   * 跳转到动画某个时间点（静止，不播放）
   * @param {string} animName
   * @param {number} timeSec 目标时间 秒
   */
  gotoTime(animName, timeSec) {
    if (!this.animator) return;
    const clip = this.clipsMap.get(animName);
    if (!clip) return;
    const dur = clip.duration;
    timeSec = THREE.MathUtils.clamp(timeSec, 0, dur);

    this._stopAction(animName);
    const action = this.animator.clipAction(clip);
    action.reset();
    action.time = timeSec;
    action.play();
    action.paused = true;
    this.activeActions.set(animName, action);
    this.animator.update(0);
  }

  /**
   * 跳转到指定帧
   * @param {string} animName
   * @param {number} frameIndex 帧序号
   * @param {number} fps 默认30
   */
  gotoFrame(animName, frameIndex, fps = 30) {
    const timeSec = frameIndex / fps;
    this.gotoTime(animName, timeSec);
  }

  /**
   * 暂停所有正在播放动画
   */
  pauseAll() {
    if (!this.animator) return;
    this.isPaused = true;
    this.activeActions.forEach((act) => {
      act.paused = true;
    });
  }

  /**
   * 继续播放
   */
  resumeAll() {
    if (!this.animator) return;
    this.isPaused = false;
    this.activeActions.forEach((act) => {
      act.paused = false;
    });
  }

  /**
   * 设置指定动画播放速度，负数倒放
   * @param {string} animName
   * @param {number} scale 1正常，-1倒放，0停止
   */
  setTimeScale(animName, scale) {
    const act = this.activeActions.get(animName);
    if (act) {
      act.timeScale = scale;
    }
  }

  /**
   * 停止某个动画
   * @param {string} animName
   */
  _stopAction(animName) {
    const oldAct = this.activeActions.get(animName);
    if (oldAct) {
      oldAct.stop();
      oldAct.reset();
      // 清理clip
      if (oldAct._clip) oldAct._clip.dispose();
    }
    this.activeActions.delete(animName);
  }

  /**
   * 停止全部动画
   */
  stopAll() {
    if (!this.animator) return;
    this.activeActions.forEach((act) => {
      act.stop();
      act.reset();
      if (act._clip) act._clip.dispose();
    });
    this.activeActions.clear();
  }

  /**
   * 每一帧必须调用 update(deltaTime)
   * @param {number} delta 帧间隔秒，来自clock.getDelta()
   */
  update(delta) {
    if (!this.animator || this.isPaused) return;
    this.animator.update(delta);
  }

  /**
   * 销毁释放资源
   */
  dispose() {
    this.stopAll();
    if (this.animator) {
      this.animator.removeEventListener('finished', this._onMixerFinished);
    }
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    this.model = null;
    this.gltf = null;
    this.animator = null;
    this.clipsMap.clear();
    this.activeActions.clear();
  }
}