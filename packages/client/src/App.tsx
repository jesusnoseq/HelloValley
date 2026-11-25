import { useTownConnection } from "./net/connection";
import { DebugOverlay } from "./ui/DebugOverlay";

export function App() {
  const connection = useTownConnection();
  return (
    <>
      <h1>HelloValley</h1>
      <DebugOverlay connection={connection} />
    </>
  );
}
