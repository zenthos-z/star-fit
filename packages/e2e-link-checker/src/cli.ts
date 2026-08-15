#!/usr/bin/env node
import { CLI } from './cli/CLI';

const cli = new CLI();
cli.run(process.argv);
