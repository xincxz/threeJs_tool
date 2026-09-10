import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GlbAnimationController } from './GlbAnimationController.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(3,2,5);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera,renderer.domElement);
const clock = new THREE.Clock();

scene.add(new THREE.DirectionalLight(0xffffff,1));
scene.add(new THREE.AmbientLight(0xffffff,0.4));

const animCtrl = new GlbAnimationController(scene);

// =====注册事件监听=====
animCtrl.on('onAnimationEnd',(animName)=>{
  console.log(`完整动画播放结束：`,animName);
})
animCtrl.on('onSegmentEnd',(animName)=>{
  console.log(`片段动画播放结束：`,animName);
})

animCtrl.loadModel('/model/test.glb',['walk','idle'])
.then(res=>{
  console.log("可用动画",animCtrl.getClipNames());

  // 播放片段：1s~3s，不循环
  animCtrl.playSegment("walk",1,3,false,1);

  // 倒放片段
  // animCtrl.playSegment("walk",1,3,false,-1);

  // 获取状态示例
  setInterval(()=>{
    const state = animCtrl.getAnimState("walk");
    console.log("状态：",state.currentTime.toFixed(2)+"s", state.currentFrame+"帧");
  },200);

})

function render(){
  requestAnimationFrame(render);
  const delta = clock.getDelta();
  animCtrl.update(delta);
  controls.update();
  renderer.render(scene,camera);
}
render();

window.addEventListener('resize',()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
})