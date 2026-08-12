// Netlify interpreta exit 0 como "cancelar este build" y exit 1 como
// "continuar". Las ramas técnicas cms/** ya se validan en GitHub Actions;
// solo el merge resultante en main debe provocar el deploy de producción.
const branch = String(process.env.BRANCH || '');
process.exitCode = branch.startsWith('cms/') ? 0 : 1;
