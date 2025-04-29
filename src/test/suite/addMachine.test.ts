import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Add Machine Command Test Suite', () => {
  vscode.window.showInformationMessage('Start Add Machine tests.');

  test('Should register add machine command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('machines.addMachine'), 'Command not found: machines.addMachine');
  });

  test('Should execute add machine command without error', async () => {
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('machines.addMachine');
    });
  });
}); 