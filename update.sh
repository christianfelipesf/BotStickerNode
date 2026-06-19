#!/bin/bash

git fetch --all
git reset --hard origin/main
git clean -fd
pm2 restart all
pm2 logs
