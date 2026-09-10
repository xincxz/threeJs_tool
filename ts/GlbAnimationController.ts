import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 动画实例单条信息类型
type AnimInstanceItem = {
    action: THREE.AnimationAction;
    clipName: string;
};

// 片段区间配置
type SegmentInfo = {
    start: number;
    end: number;
    loop: boolean;
};

// 事件回调类型
type EventHandlers = {
    onAnimationEnd: ((animName: string) => null | void) | null;
    onSegmentEnd: ((animName: string) => null | void) | null;
};

export class GlbAnimationController {
    private readonly scene: THREE.Scene;
    private readonly loader: GLTFLoader;

    private gltf: THREE.GLTF | null = null;
    public model: THREE.Object3D | null = null;
    private animator: THREE.AnimationMixer | null = null;

    // 原始动画缓存：动画名称 -> 动画Clip
    private clipsMap: Map<string, THREE.AnimationClip> = new Map();
    // 运行动画实例池：唯一实例ID -> 实例数据
    private actionInstances: Map<string, AnimInstanceItem> = new Map();
    // 片段播放配置：实例ID -> 片段区间
    private _segmentPlayInfo: Map<string, SegmentInfo> = new Map();

    private isPaused = false;
    private _eventCallbacks: EventHandlers = {
        onAnimationEnd: null,
        onSegmentEnd: null,
    };
    private readonly _onMixerFinished: (e: THREE.Event) => void;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.loader = new GLTFLoader();
        this._onMixerFinished = this._handleMixerFinished.bind(this);
    }

    /** 生成唯一动画实例ID */
    private _genInstanceId(): string {
        return `anim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * 加载GLB模型，可选过滤指定动画名称
     * @param url 模型路径
     * @param includeAnimNames 需要加载的动画名数组，空=全部加载
     */
    loadModel(url: string, includeAnimNames: string[] = []): Promise<{
        model: THREE.Object3D;
        clips: THREE.AnimationClip[];
    }> {
        return new Promise((resolve, reject) => {
            this.loader.load(
                url,
                (gltf) => {
                    this.gltf = gltf;
                    this.model = gltf.scene;
                    this.scene.add(this.model);

                    this.animator = new THREE.AnimationMixer(this.model);
                    this.animator.addEventListener('finished', this._onMixerFinished);

                    this.clipsMap.clear();
                    this.actionInstances.clear();
                    this._segmentPlayInfo.clear();

                    const allClips: THREE.AnimationClip[] = gltf.animations ?? [];
                    let useClips: THREE.AnimationClip[];
                    if (includeAnimNames.length > 0) {
                        useClips = allClips.filter((clip) => includeAnimNames.includes(clip.name));
                    } else {
                        useClips = [...allClips];
                    }
                    useClips.forEach((clip) => this.clipsMap.set(clip.name, clip));

                    resolve({ model: this.model, clips: useClips });
                },
                () => void 0,
                (err) => reject(err)
            );
        });
    }

    /** 绑定动画结束事件 */
    on(eventName: keyof EventHandlers, callback: (animName: string) => void): void {
        this._eventCallbacks[eventName] = callback;
    }

    /** mixer原生播放完成回调 */
    private _handleMixerFinished(e: THREE.Event): void {
        const action = e.action as THREE.AnimationAction | undefined;
        if (!action) return;

        // 片段动画由update循环控制结束，跳过mixer事件
        let skip = false;
        for (const [instId] of this._segmentPlayInfo) {
            const inst = this.actionInstances.get(instId);
            if (inst?.action === action) {
                skip = true;
                break;
            }
        }
        if (skip || !action._clip) return;

        const clipName = action._clip.name;
        if (this._eventCallbacks.onAnimationEnd) {
            this._eventCallbacks.onAnimationEnd(clipName);
        }
    }

    /** 获取全部可用动画名称 */
    getClipNames(): string[] {
        return Array.from(this.clipsMap.keys());
    }

    /** 获取指定动画总时长(秒) */
    getClipDuration(animName: string): number {
        const clip = this.clipsMap.get(animName);
        return clip ? clip.duration : 0;
    }

    /** 获取动画总帧数 */
    getClipTotalFrames(animName, fps = 30): number {
        const dur = this.getClipDuration(animName);
        return Math.floor(dur * fps);
    }

    /** 根据实例ID获取当前播放时间 */
    getCurrentTime(instanceId: string): number {
        const inst = this.actionInstances.get(instanceId);
        return inst ? inst.action.time : 0;
    }

    /** 根据实例ID获取当前帧 */
    getCurrentFrame(instanceId: string, fps = 30): number {
        return Math.floor(this.getCurrentTime(instanceId) * fps);
    }

    /**
     * 完整播放动画，返回实例ID，支持多实例并行
     * @param animName 动画名称
     * @param loop 是否循环
     * @param timeScale 播放速度 1正向 / -1倒放
     * @param weight 骨骼混合权重 0~1
     * @returns 动画实例ID | null
     */
    playFull(
        animName: string,
        loop = false,
        timeScale = 1,
        weight = 1
    ): string | null {
        if (!this.animator) return null;
        const clip = this.clipsMap.get(animName);
        if (!clip) {
            console.warn(`不存在动画:${animName}`);
            return null;
        }

        const instanceId = this._genInstanceId();
        const action = this.animator.clipAction(clip);
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = true;
        action.timeScale = timeScale;
        action.weight = weight;
        action.play();

        this.actionInstances.set(instanceId, { action, clipName: animName });
        this._segmentPlayInfo.delete(instanceId);
        this.isPaused = false;
        return instanceId;
    }

    /**
     * 播放指定时间片段动画，返回实例ID
     * @param animName 动画名
     * @param startSec 起始秒
     * @param endSec 结束秒
     * @param loop 是否循环片段
     * @param timeScale 速度
     * @param weight 混合权重
     */
    playSegment(
        animName: string,
        startSec: number,
        endSec: number,
        loop = false,
        timeScale = 1,
        weight = 1
    ): string | null {
        if (!this.animator) return null;
        const srcClip = this.clipsMap.get(animName);
        if (!srcClip) {
            console.warn(`不存在动画:${animName}`);
            return null;
        }

        const dur = srcClip.duration;
        const s = Math.max(0, startSec);
        const e = Math.min(dur, endSec);
        if (s >= e) return null;

        const instanceId = this._genInstanceId();
        const action = this.animator.clipAction(srcClip);
        action.reset();
        action.time = timeScale >= 0 ? s : e;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.timeScale = timeScale;
        action.weight = weight;
        action.play();

        this.actionInstances.set(instanceId, { action, clipName: animName });
        this._segmentPlayInfo.set(instanceId, { start: s, end: e, loop });
        this.isPaused = false;
        return instanceId;
    }

    /** 定格到指定时间，生成静止动画实例 */
    gotoTime(animName: string, timeSec: number, weight = 1): string | null {
        if (!this.animator) return null;
        const clip = this.clipsMap.get(animName);
        if (!clip) return null;

        const dur = clip.duration;
        const t = THREE.MathUtils.clamp(timeSec, 0, dur);
        const instanceId = this._genInstanceId();

        const action = this.animator.clipAction(clip);
        action.reset();
        action.time = t;
        action.weight = weight;
        action.play();
        action.paused = true;

        this.actionInstances.set(instanceId, { action, clipName: animName });
        this._segmentPlayInfo.delete(instanceId);
        this.animator.update(0);
        return instanceId;
    }

    /** 定格到指定帧 */
    gotoFrame(animName: string, frameIndex: number, fps = 30, weight = 1): string | null {
        return this.gotoTime(animName, frameIndex / fps, weight);
    }

    /** 全局暂停所有动画，控制台打印每个实例当前时间 */
    pauseAll(): void {
        if (!this.animator) return;
        this.isPaused = true;
        for (const [instId, inst] of this.actionInstances) {
            inst.action.paused = true;
            const cur = inst.action.time.toFixed(3);
            console.log(`[全局暂停] ID:${instId} | 动画:${inst.clipName} | 当前时间:${cur}s`);
        }
    }

    /** 全局继续所有动画 */
    resumeAll(): void {
        if (!this.animator) return;
        this.isPaused = false;
        for (const inst of this.actionInstances.values()) {
            inst.action.paused = false;
        }
    }

    /** 根据实例ID单独暂停某一个动画 */
    pauseOne(instanceId: string): boolean {
        const inst = this.actionInstances.get(instanceId);
        if (!inst) return false;
        inst.action.paused = true;
        const cur = inst.action.time.toFixed(3);
        console.log(`[单实例暂停] ID:${instanceId} | ${inst.clipName} | ${cur}s`);
        return true;
    }

    /** 根据实例ID单独继续某一个动画 */
    resumeOne(instanceId: string): boolean {
        const inst = this.actionInstances.get(instanceId);
        if (!inst) return false;
        inst.action.paused = false;
        return true;
    }

    /** 根据实例ID销毁单个动画 */
    stopOne(instanceId: string): boolean {
        const inst = this.actionInstances.get(instanceId);
        if (!inst) return false;
        inst.action.stop();
        inst.action.reset();
        this.actionInstances.delete(instanceId);
        this._segmentPlayInfo.delete(instanceId);
        return true;
    }

    /** 停止并清空所有动画实例 */
    stopAll(): void {
        if (!this.animator) return;
        for (const inst of this.actionInstances.values()) {
            inst.action.stop();
            inst.action.reset();
        }
        this.actionInstances.clear();
        this._segmentPlayInfo.clear();
    }

    /** 修改单个实例播放速度 */
    setInstanceTimeScale(instanceId: string, scale: number): void {
        const inst = this.actionInstances.get(instanceId);
        if (inst) inst.action.timeScale = scale;
    }

    /** 每帧更新，必须在requestAnimationFrame中调用 */
    update(delta: number): void {
        if (!this.animator || this.isPaused) return;
        this.animator.update(delta);

        const toRemove: string[] = [];
        for (const [instId, segInfo] of this._segmentPlayInfo) {
            const inst = this.actionInstances.get(instId);
            if (!inst) {
                toRemove.push(instId);
                continue;
            }
            const { action } = inst;
            const { start, end, loop } = segInfo;
            const t = action.time;
            const speed = action.timeScale;

            // 正向到达终点
            if (speed > 0 && t >= end) {
                if (loop) action.time = start;
                else {
                    action.paused = true;
                    toRemove.push(instId);
                    if (this._eventCallbacks.onSegmentEnd) {
                        this._eventCallbacks.onSegmentEnd(inst.clipName);
                    }
                }
            }
            // 倒放到达起点
            if (speed < 0 && t <= start) {
                if (loop) action.time = end;
                else {
                    action.paused = true;
                    toRemove.push(instId);
                    if (this._eventCallbacks.onSegmentEnd) {
                        this._eventCallbacks.onSegmentEnd(inst.clipName);
                    }
                }
            }
        }
        toRemove.forEach((id) => this._segmentPlayInfo.delete(id));
    }

    /** 销毁模型、释放所有资源 */
    dispose(): void {
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
                        obj.material.forEach((m) => m.dispose());
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
        this.actionInstances.clear();
        this._segmentPlayInfo.clear();
    }
}