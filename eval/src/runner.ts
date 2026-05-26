export async function main(): Promise<void> {
  console.log('coderouter eval harness scaffold');
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
