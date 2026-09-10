

配套 package.json 依赖
{
  "dependencies": {
  "three": "0.146.0"
},
  "devDependencies": {
  "typescript": "^5",
    "@types/three": "0.146.0"
}
}


tsconfig.json 关键配置
{
  "compilerOptions": {
  "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
}
}