import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GlbAnimationController } from './GlbAnimationController';

// 初始化场景
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(3, 2, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
const clock = new THREE.Clock();

// 光照
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(6, 10, 6);
scene.add(dirLight);

// 实例控制器
const animCtrl = new GlbAnimationController(scene);

// 加载模型
animCtrl.loadModel('./model/test.glb')
    .then((res) => {
        console.log('动画列表', animCtrl.getClipNames());
        // 并行播放两个动作
        const id1 = animCtrl.playFull('walk', true, 1, 0.5);
        const id2 = animCtrl.playFull('wave', true, 1, 0.5);
        // 单独暂停其中一个
        // animCtrl.pauseOne(id1);
    });

// 注册片段结束回调
animCtrl.on('onSegmentEnd', (name) => {
    console.log('片段播放完毕', name);
});

function render() {
    requestAnimationFrame(render);
    const delta = clock.getDelta();
    animCtrl.update(delta);
    controls.update();
    renderer.render(scene, camera);
}
render();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});