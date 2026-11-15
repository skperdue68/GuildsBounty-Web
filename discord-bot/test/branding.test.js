import test from 'node:test';
import assert from 'node:assert/strict';
import { commands } from '../src/commands.js';
import { createHandler } from '../src/handler.js';

test('Discord registers the Guilds Bounty command with all subcommands', () => {
  assert.equal(commands[0].name, 'guildsbounty');
  assert.match(commands[0].description, /Guild's Bounty/);
  assert.equal(commands[0].options.length, 8);
});

test('Guilds Bounty help uses the registered branded command', async () => {
  const interaction = {
    commandName: 'guildsbounty', guildId: 'guild', user: { id: 'user' }, member: { roles: [] },
    isChatInputCommand: () => true, options: { getSubcommand: () => 'help' },
    async deferReply() {}, async editReply(value) { this.result = value; },
  };
  await createHandler({guildId:'guild',api:()=>assert.fail('help needs no API')})(interaction);
  assert.match(interaction.result?.content || '', /\/guildsbounty browse/);
  assert.doesNotMatch(interaction.result.content, /\/items\b/);
});
