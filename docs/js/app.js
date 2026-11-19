import { mountDynamics } from './dynamics.js';

const status = document.getElementById('status');
const app = mountDynamics(document.getElementById('dynamics-workspace'));
function report(message = '', error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}
function save(project) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (project.name || 'SuspensionDynamicsLab').replace(/[^\p{L}\p{N}._-]+/gu, '-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('new-project').addEventListener('click', async () => {
  try { await app.newProject(); report('New project loaded.'); }
  catch (error) { report(error.message, true); }
});
document.getElementById('open-settings').addEventListener('click', () => app.openVehicle());
document.getElementById('import-project').addEventListener('click', () => document.getElementById('project-file').click());
document.getElementById('project-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const value = JSON.parse((await file.text()).replace(/^\ufeff/, ''));
    await app.importProject(value.dynamics_project || value);
    report('Imported ' + file.name + '.');
  } catch (error) { report(error.message, true); }
});
document.getElementById('save-project').addEventListener('click', async () => {
  try { save(await app.exportProject()); report('Project JSON download started.'); }
  catch (error) { report(error.message, true); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'F5') { event.preventDefault(); app.run(); }
  if ((event.ctrlKey || event.metaKey) && ['o', 's'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    document.getElementById(event.key.toLowerCase() === 'o' ? 'import-project' : 'save-project').click();
  }
});
await app.activate();
