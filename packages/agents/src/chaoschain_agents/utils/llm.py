"""
Language Model Client for ChaosChain Agents.

This module provides a production-ready interface for LLM interactions with OpenAI,
supporting the layered prompting architecture with role_prompt and character_prompt chaining.
Integrates with LangGraph for advanced agent workflow capabilities.
"""

import json
import os
from typing import Any, Dict, Optional, List
from dotenv import load_dotenv
from loguru import logger

import openai
from openai import AsyncOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import create_react_agent

# Load environment variables
load_dotenv()


class LanguageModelClient:
    """
    Production-ready client for interacting with OpenAI Language Models in ChaosChain agents.
    
    Supports the layered prompting architecture and integrates with LangGraph for 
    sophisticated agent workflows. Provides both simple chat completion and 
    advanced graph-based agent capabilities.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the LLM client with OpenAI integration.
        
        Args:
            api_key: OpenAI API key. If not provided, will use OPENAI_API_KEY env var.
        """
        # Get API key from parameter or environment
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        
        if not self.api_key:
            raise ValueError(
                "OpenAI API key is required. Set OPENAI_API_KEY environment variable "
                "or pass api_key parameter to LanguageModelClient."
            )
        
        # Initialize OpenAI async client
        self.client = AsyncOpenAI(api_key=self.api_key)
        
        # Default models and settings
        self.default_model = "gpt-4o-mini"  # Cost-effective default
        self.fallback_model = "gpt-4o"  # Backup option
        
        # LangGraph agent cache for reusable workflows
        self._langgraph_agents: Dict[str, Any] = {}
        
        logger.info(f"Initialized OpenAI LanguageModelClient with model: {self.default_model}")
        
        # Test API connection
        try:
            # This will validate the API key without making a costly call
            logger.debug("Testing OpenAI API connection...")
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI client: {e}")
            raise
    
    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> str:
        """
        Generate a response using OpenAI's language model.
        
        Args:
            system_prompt: The system prompt (chained from role_prompt + character_prompt)
            user_prompt: The user prompt with task-specific information
            model: Model to use for generation (defaults to self.default_model)
            temperature: Temperature for response generation
            max_tokens: Maximum tokens for the response
            **kwargs: Additional OpenAI API parameters
            
        Returns:
            The generated response from the LLM
        """
        # Use provided model or default
        model = model or self.default_model
        
        logger.info(f"Generating LLM response using {model}")
        logger.debug(f"System prompt length: {len(system_prompt)} chars")
        logger.debug(f"User prompt length: {len(user_prompt)} chars")
        
        try:
            # Create the chat completion
            response = await self.client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs
            )
            
            # Extract the response content
            content = response.choices[0].message.content
            
            if not content:
                raise ValueError("OpenAI returned empty response")
            
            logger.info(f"Generated response of {len(content)} characters")
            logger.debug(f"Token usage: {response.usage.total_tokens if response.usage else 'unknown'}")
            
            return content
            
        except openai.RateLimitError as e:
            logger.warning(f"Rate limit hit, retrying with fallback model: {e}")
            # Retry with fallback model
            if model != self.fallback_model:
                return await self.generate_response(
                    system_prompt, user_prompt, self.fallback_model, temperature, max_tokens, **kwargs
                )
            raise
            
        except openai.APIError as e:
            logger.error(f"OpenAI API error: {e}")
            # For production, you might want to implement fallback to cached responses
            # or alternative providers here
            raise
            
        except Exception as e:
            logger.error(f"Unexpected error generating response: {e}")
            raise
    
    async def create_langgraph_agent(
        self,
        agent_id: str,
        tools: List[Any] = None,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None
    ) -> Any:
        """
        Create a LangGraph ReAct agent for more sophisticated workflows.
        
        This integrates with LangGraph's powerful orchestration capabilities,
        allowing for tool usage, memory, and complex multi-step reasoning.
        
        Args:
            agent_id: Unique identifier for caching the agent
            tools: List of tools the agent can use
            model: Model to use (defaults to self.default_model)
            system_prompt: System prompt for the agent
            
        Returns:
            LangGraph agent instance
        """
        if agent_id in self._langgraph_agents:
            logger.debug(f"Returning cached LangGraph agent: {agent_id}")
            return self._langgraph_agents[agent_id]
        
        model = model or self.default_model
        tools = tools or []
        
        try:
            # Create a ReAct agent with LangGraph
            # Note: This requires proper model configuration with LangChain
            from langchain_openai import ChatOpenAI
            
            chat_model = ChatOpenAI(
                model=model,
                openai_api_key=self.api_key,
                temperature=0.7
            )
            
            agent = create_react_agent(
                model=chat_model,
                tools=tools,
                prompt=system_prompt or "You are a helpful AI assistant."
            )
            
            # Cache the agent
            self._langgraph_agents[agent_id] = agent
            
            logger.info(f"Created LangGraph ReAct agent: {agent_id} with {len(tools)} tools")
            return agent
            
        except Exception as e:
            logger.error(f"Failed to create LangGraph agent: {e}")
            raise
    
    async def run_langgraph_workflow(
        self,
        agent_id: str,
        messages: List[Dict[str, str]],
        tools: List[Any] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Run a LangGraph workflow with the specified agent.
        
        Args:
            agent_id: Agent identifier
            messages: List of messages in the conversation
            tools: Tools available to the agent
            **kwargs: Additional parameters
            
        Returns:
            Agent response and workflow state
        """
        try:
            agent = await self.create_langgraph_agent(agent_id, tools, **kwargs)
            
            # Convert messages to LangGraph format
            formatted_messages = []
            for msg in messages:
                if msg.get("role") == "user":
                    formatted_messages.append(HumanMessage(content=msg["content"]))
                elif msg.get("role") == "system":
                    formatted_messages.append(SystemMessage(content=msg["content"]))
            
            # Invoke the agent
            result = agent.invoke({"messages": formatted_messages})
            
            logger.debug(f"LangGraph workflow completed for agent: {agent_id}")
            return result
            
        except Exception as e:
            logger.error(f"LangGraph workflow failed: {e}")
            raise

    async def generate_structured_response(
        self,
        system_prompt: str,
        user_prompt: str,
        response_format: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate a structured response in a specific format using OpenAI's structured outputs.
        
        Args:
            system_prompt: The system prompt
            user_prompt: The user prompt
            response_format: Expected response structure
            **kwargs: Additional LLM parameters
            
        Returns:
            Structured response matching the format
        """
        try:
            # Use OpenAI's JSON mode for more reliable structured output
            enhanced_prompt = (
                f"{user_prompt}\n\n"
                f"Please respond with a valid JSON object matching this exact structure: "
                f"{json.dumps(response_format, indent=2)}\n\n"
                f"Important: Your response must be valid JSON and nothing else."
            )
            
            # Enable JSON mode if model supports it
            model = kwargs.get('model', self.default_model)
            json_kwargs = {}
            
            if 'gpt-4' in model or 'gpt-3.5' in model:
                json_kwargs['response_format'] = {"type": "json_object"}
            
            raw_response = await self.generate_response(
                system_prompt=system_prompt,
                user_prompt=enhanced_prompt,
                **{**kwargs, **json_kwargs}
            )
            
            # Parse the JSON response
            try:
                parsed_response = json.loads(raw_response.strip())
                logger.debug("Successfully parsed structured JSON response")
                return parsed_response
                
            except json.JSONDecodeError as json_error:
                logger.warning(f"Failed to parse JSON response: {json_error}")
                
                # Attempt to extract JSON from the response
                import re
                json_match = re.search(r'\{.*\}', raw_response, re.DOTALL)
                if json_match:
                    try:
                        return json.loads(json_match.group())
                    except json.JSONDecodeError:
                        pass
                
                # Create a fallback structured response
                return {
                    "analysis": raw_response,
                    "confidence": 0.5,  # Lower confidence for fallback
                    "prediction": "Unable to parse structured prediction",
                    "reasoning": "Generated from unstructured response due to JSON parsing error",
                    "error": f"JSON parsing failed: {str(json_error)}"
                }
                
        except Exception as e:
            logger.error(f"Error generating structured response: {e}")
            return {
                "analysis": "Error occurred during analysis",
                "confidence": 0.0,
                "prediction": "Error",
                "reasoning": f"Analysis failed due to error: {str(e)}",
                "error": str(e)
            }
    
    async def test_connection(self) -> bool:
        """
        Test the OpenAI API connection.
        
        Returns:
            True if connection is successful, False otherwise
        """
        try:
            # Make a minimal API call to test connection
            response = await self.client.chat.completions.create(
                model=self.default_model,
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=5
            )
            
            logger.info("OpenAI API connection test successful")
            return True
            
        except Exception as e:
            logger.error(f"OpenAI API connection test failed: {e}")
            return False
    
    def estimate_tokens(self, text: str) -> int:
        """
        Estimate the number of tokens in a text.
        
        This is a rough approximation. For precise token counting,
        consider using tiktoken library.
        
        Args:
            text: Text to estimate tokens for
            
        Returns:
            Estimated token count
        """
        # Rough approximation: 1 token ≈ 4 characters for English text
        # This varies by model and language, but gives a reasonable estimate
        return len(text) // 4
    
    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the current model configuration.
        
        Returns:
            Dictionary with model information
        """
        return {
            "default_model": self.default_model,
            "fallback_model": self.fallback_model,
            "api_key_configured": bool(self.api_key),
            "langgraph_agents_cached": list(self._langgraph_agents.keys())
        }
    
    async def is_available(self) -> bool:
        """
        Check if the LLM client is available and can make API calls.
        
        Returns:
            True if available, False otherwise
        """
        if not self.api_key:
            return False
        
        try:
            return await self.test_connection()
        except Exception:
            return False
    
    async def clear_cache(self) -> None:
        """Clear cached LangGraph agents."""
        self._langgraph_agents.clear()
        logger.info("Cleared LangGraph agent cache") 