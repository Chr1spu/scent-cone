import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

export default function App() {
  return (
    <div className="h-full w-full">
      <Canvas camera={{ position: [0, 2000, 3000], far: 50000 }}>
        <color attach="background" args={['#0a0f14']} />
        <gridHelper args={[3000, 30, '#2b3b4a', '#16202a']} />
        <OrbitControls />
      </Canvas>
      <div className="absolute top-4 left-4 panel px-4 py-2 font-semibold">Scent Cone</div>
    </div>
  );
}
