import staticPlugin from "@elysiajs/static";
import { Elysia } from "elysia";

const app = new Elysia()
.use(staticPlugin({assets: "public", prefix: "/", indexHTML: true}))
.ws("/ws", {
  open: (socket) => {
    console.log("Client connected", socket.id);
  },
  close: (socket) => {
    console.log("Client disconnected", socket.id);
  },
  message: (socket, message) => {
    console.log("Client message", socket.id, message);
  },
})
.listen(3000, () => console.log("Server started on http://localhost:3000"));

export default app;