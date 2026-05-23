import { GridApp } from './GridApp';
import { ConfigApp } from './ConfigApp';

export default function App() {
  const isConfig = window.location.pathname.replace(/\/$/, '') === '/config';
  return isConfig ? <ConfigApp /> : <GridApp />;
}
