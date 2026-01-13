const express = require('express');
const router = express.Router();
const aiController = require('./ai.controller');

/**
 * @route   POST /api/ai/chat
 * @desc    Get AI-generated answer for event queries using RAG
 * @access  Public (or as per project needs)
 */
router.post('/chat', aiController.handleChat);

/**
 * @route   POST /api/ai/search
 * @desc    Standard text search without AI/LLM
 */
router.post('/search', aiController.handleStandardSearch);

module.exports = router;
