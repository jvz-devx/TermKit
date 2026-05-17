import assert from 'node:assert/strict';

export async function exerciseBrowserFileManager(
	page,
	{ hostId, apiBase, label, fixtureName, workspaceName, timeoutMs, waitFor }
) {
	const manager = page.getByRole('region', { name: `${label} file manager` });
	const remotePath = manager.getByLabel('Remote path');
	const uploadName = `${workspaceName}-upload.txt`;
	const renamedName = `${workspaceName}-renamed.txt`;
	const workspacePath = `/${workspaceName}`;
	const renamedPath = `${workspacePath}/${renamedName}`;
	const uploadedText = `${label} browser upload through production endpoint\n`;
	const editedText = `${label} browser edit through production endpoint\n`;

	await manager.waitFor({ timeout: timeoutMs });
	await manager.getByRole('button', { name: fixtureName, exact: true }).waitFor({
		timeout: timeoutMs
	});
	await waitForInputValue(remotePath, '/', `${label} file manager did not open at root.`, waitFor);

	await manager.getByLabel('New folder name').fill(workspaceName);
	await manager.getByRole('button', { name: 'Create directory' }).click();
	await manager.getByRole('button', { name: workspaceName, exact: true }).waitFor({
		timeout: timeoutMs
	});
	await manager.getByRole('button', { name: workspaceName, exact: true }).click();
	await waitForInputValue(
		remotePath,
		workspacePath,
		`${label} file manager did not enter ${workspacePath}.`,
		waitFor
	);

	const fileChooserPromise = page.waitForEvent('filechooser', { timeout: timeoutMs });
	await manager.getByRole('button', { name: 'Choose file for upload' }).click();
	const chooser = await fileChooserPromise;
	await chooser.setFiles({
		name: uploadName,
		mimeType: 'text/plain',
		buffer: Buffer.from(uploadedText)
	});
	await manager.getByRole('button', { name: uploadName, exact: true }).waitFor({
		timeout: timeoutMs
	});

	await manager.getByRole('button', { name: uploadName, exact: true }).click();
	const editor = manager.getByPlaceholder('Open a text file to edit it');
	await waitForInputValue(
		editor,
		uploadedText,
		`${label} text editor did not read the uploaded file through the app endpoint.`,
		waitFor
	);
	await editor.fill(editedText);
	const saveResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'PUT' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/text`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	const listAfterSaveResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/list`) &&
			response.url().includes(`path=${encodeURIComponent(workspacePath)}`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	await manager.getByRole('button', { name: 'Save text file' }).click();
	await saveResponse;
	await listAfterSaveResponse;
	await waitForInputValue(
		editor,
		editedText,
		`${label} text editor did not retain the saved edit.`,
		waitFor
	);

	await manager.getByRole('button', { name: uploadName, exact: true }).click();
	const renameInput = manager.getByLabel('Rename or move target path');
	await waitForLocatorEnabled(
		renameInput,
		`${label} rename input did not enable after selecting ${uploadName}.`,
		waitFor
	);
	await renameInput.fill(renamedPath);
	const renameButton = manager.getByRole('button', { name: 'Rename or move selected path' });
	await waitForLocatorEnabled(
		renameButton,
		`${label} rename button did not enable after setting ${renamedPath}.`,
		waitFor
	);
	await renameButton.click();
	await manager.getByRole('button', { name: renamedName, exact: true }).waitFor({
		timeout: timeoutMs
	});

	await manager.getByRole('button', { name: 'Parent directory' }).click();
	await waitForInputValue(
		remotePath,
		'/',
		`${label} file manager did not navigate back to root.`,
		waitFor
	);
	await manager.getByLabel('Remote search').fill(renamedName);
	await manager.getByRole('button', { name: 'Tree search' }).click();
	await manager.getByText('Search results (1)', { exact: true }).waitFor({ timeout: timeoutMs });
	await manager.getByRole('button', { name: renamedPath, exact: true }).click();
	await waitForInputValue(
		remotePath,
		workspacePath,
		`${label} search result did not navigate to ${workspacePath}.`,
		waitFor
	);

	const downloadResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/download`) &&
			response.url().includes(`path=${encodeURIComponent(renamedPath)}`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	const downloadButton = manager.getByRole('button', { name: 'Download selected paths' });
	await waitForLocatorEnabled(
		downloadButton,
		`${label} download button did not enable after selecting ${renamedName}.`,
		waitFor
	);
	await downloadButton.click();
	const downloaded = await downloadResponse;
	const downloadedText = await downloaded.text();
	assert.equal(
		downloadedText,
		editedText,
		`${label} browser download returned the wrong file contents.`
	);

	const deleteButton = manager.getByRole('button', { name: 'Delete selected paths' });
	await waitForLocatorEnabled(
		deleteButton,
		`${label} delete button did not enable after selecting ${renamedName}.`,
		waitFor
	);
	await deleteButton.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete selected' }).click();
	await waitForLocatorCount(
		manager.getByRole('button', { name: renamedName, exact: true }),
		0,
		`${label} file manager did not remove ${renamedName}.`,
		waitFor
	);

	await manager.getByRole('button', { name: 'Parent directory' }).click();
	await waitForInputValue(
		remotePath,
		'/',
		`${label} file manager did not return to root.`,
		waitFor
	);
	await manager.getByLabel('Remote search').fill('');
	await manager.getByLabel(`Select ${workspaceName}`).click();
	await waitForLocatorEnabled(
		deleteButton,
		`${label} delete button did not enable after selecting ${workspaceName}.`,
		waitFor
	);
	await deleteButton.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete selected' }).click();
	await waitForLocatorCount(
		manager.getByRole('button', { name: workspaceName, exact: true }),
		0,
		`${label} file manager did not remove ${workspaceName}.`,
		waitFor
	);
}

async function waitForInputValue(locator, expected, message, waitFor) {
	await waitFor(async () => {
		const value = await locator.inputValue().catch(() => null);
		return value === expected;
	}, message);
}

async function waitForLocatorCount(locator, expected, message, waitFor) {
	await waitFor(async () => (await locator.count()) === expected, message);
}

async function waitForLocatorEnabled(locator, message, waitFor) {
	await waitFor(async () => locator.isEnabled().catch(() => false), message);
}
