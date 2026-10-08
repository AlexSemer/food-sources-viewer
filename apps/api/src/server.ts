import { createServer } from "node:http";
import { handle, PORT } from "./app.ts";

createServer(handle).listen(PORT, () => {
  console.log(`api http://127.0.0.1:${PORT}`);
});
