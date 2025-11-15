#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import App from './ui/App.js';
import Navigator from './ui/Navigator.js';

const argv = process.argv.slice(2);
const first = argv[0];
const legacy = first === 'dirs' || first === 'files' || first === 'nodes' || first === 'preset' || first === '--';
const nonTty = !process.stdin.isTTY; // fallback to non-interactive UI when no TTY

render(legacy || nonTty ? <App /> : <Navigator />);
