// Manage only this site's CSP using the existing Wrangler login or a scoped API token.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const configPath = path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml');
  const config = process.env.CLOUDFLARE_API_TOKEN ? '' : fs.readFileSync(configPath, 'utf8');
  const token = process.env.CLOUDFLARE_API_TOKEN || config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(token, 'Sign in with Wrangler or provide a scoped CLOUDFLARE_API_TOKEN.');
  async function api(endpoint, options = {}) {
    const response = await fetch('https://api.cloudflare.com/client/v4' + endpoint, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    assert.ok(response.ok && body.success, `Cloudflare ${endpoint} HTTP ${response.status}: ${body.errors?.map(error => error.message).join('; ') || 'request rejected'}`);
    return body.result;
  }
  const zones = await api('/zones?name=manjilbasnet.com.np');
  assert.equal(zones.length, 1, 'Expected exactly one portfolio zone.');
  const zone = zones[0];
  const endpoint = `/zones/${zone.id}/rulesets/phases/http_response_headers_transform/entrypoint`;
  const current = await api(endpoint);
  console.log(JSON.stringify({
    zone: zone.name,
    rules: current.rules.map(rule => ({ id: rule.id, description: rule.description, expression: rule.expression, enabled: rule.enabled, headers: rule.action_parameters?.headers })),
  }, null, 2));
  if (!process.argv.includes('--apply')) return;
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'csp-policy.json'), 'utf8'));
  const name = 'Portfolio content security policy';
  const cspRules = current.rules.filter(rule => Object.keys(rule.action_parameters?.headers || {}).some(header => header.toLowerCase() === 'content-security-policy'));
  assert.ok(cspRules.length <= 1, 'Multiple existing CSP rules require review.');
  const target = cspRules[0];
  const newRule = {
    action: 'rewrite',
    action_parameters: { headers: { 'content-security-policy': { operation: 'set', value: policy.value } } },
    expression: '(http.host in {"manjilbasnet.com.np" "www.manjilbasnet.com.np"})',
    description: name,
    enabled: true,
  };
  if (target) await api(`/zones/${zone.id}/rulesets/${current.id}/rules/${target.id}`, { method: 'PATCH', body: JSON.stringify(newRule) });
  else await api(`/zones/${zone.id}/rulesets/${current.id}/rules`, { method: 'POST', body: JSON.stringify(newRule) });
  const saved = await api(endpoint);
  assert.ok(saved.rules.some(rule => rule.description === name && rule.action_parameters?.headers?.['content-security-policy']?.value === policy.value));
  console.log('Portfolio CSP saved and verified.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
