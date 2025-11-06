import {
	test,
	expect
} from 'npm:@playwright/test';

const port = process.env.E2E_TEST_PORT || 8088;

test('homepage has expected title', async ({
	page
}) => {
	await page.goto(`http://localhost:${port}/`);
	await expect(page).toHaveTitle(/fount/i);
});
