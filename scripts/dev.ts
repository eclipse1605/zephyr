import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = ["dev:worker", "dev:api", "dev:web"].map((script) =>
  spawn("bun", ["run", script], { stdio: "inherit" }),
);

function stop() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exit(code);
    }
  });
}
