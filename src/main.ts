import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'npm:express';

const app = express();
const port = 8931;

// Add JSON parsing middleware
app.use(express.json());

// API endpoint to fetch character details
app.get('/api/getdetails/chars', async (req, res) => {
  try {
    const charName = req.query.name as string;
    
    if (!charName) {
      return res.status(400).json({ error: 'Character name is required' });
    }

    // Construct the path to the character's fount.json file
    const fountJsonPath = join(process.cwd(), 'default/templates/user/chars', charName, 'fount.json');
    
    try {
      // Read and parse the character's fount.json file
      const fountJsonContent = await readFile(fountJsonPath, 'utf-8');
      const charDetails = JSON.parse(fountJsonContent);
      
      res.json(charDetails);
    } catch (fileError) {
      // Handle file not found or JSON parsing errors
      if ((fileError as any)?.code === 'ENOENT') {
        return res.status(404).json({ error: `Character '${charName}' not found` });
      } else {
        return res.status(500).json({ error: 'Failed to read character data' });
      }
    }
  } catch (error) {
    console.error('Error in /api/getdetails/chars:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});