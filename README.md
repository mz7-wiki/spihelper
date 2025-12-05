# spihelper

This is a fork of GeneralNotability's spihelper tool.

The most significant difference is that it modularizes the code. Whereas in GeneralNotability's upstream script, the entire script lived in a single monolithic script with 3600+ lines, here we have split up the script into a few different pieces that are intended to be concatenated together in the end. The main benefit of doing this is that it enables much easier AI-driven development. The earlier 3600-line version makes it difficult for AI agents to load the entire script, as it might exceed their context window.

A helpful `build.py` Python script is provided as a convenient way to concatenate all the pieces into a spihelper.js file that can be installed on Wikipedia at your Special:MyPage/spihelper.js and imported to your common.js.
