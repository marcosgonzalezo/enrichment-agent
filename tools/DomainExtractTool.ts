import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { 
  DomainExtractionInput, 
  SearchResult,
  ValidationError,
  EnrichmentError,
  DOMAIN_REGEX
} from "../types";

export const domainExtractTool = (model: ChatOpenAI) =>
  tool(
    async ({ results }: DomainExtractionInput): Promise<string> => {
      try {
        // Validate input
        if (!results || !Array.isArray(results) || results.length === 0) {
          throw new ValidationError("Results array is required and cannot be empty", "results");
        }

        // Validate each result has required fields
        for (const result of results) {
          if (!result.title || !result.url || !result.content) {
            throw new ValidationError("Each search result must have title, url, and content", "result");
          }
        }

        const response = await model.invoke([
          new HumanMessage(
            `Extract the official website domain (just the domain, like "example.com") for the company from these search results. 
            
            Rules:
            - Only return the domain without any explanation or additional text
            - Avoid using results from linkedin.com, crunchbase.com, or other third-party sites
            - Prefer the official company website
            - If no clear official website is found, return "not_found"
            - The domain should be in the format: example.com (no http:// or www.)
            
            Search results:
            ${JSON.stringify(results, null, 2)}`
          ),
        ]);

        const extractedDomain = response.content.toString().trim().toLowerCase();

        if (extractedDomain === "not_found") {
          throw new EnrichmentError("No official website domain found in search results", "DOMAIN_NOT_FOUND");
        }

        // Validate the extracted domain
        if (!DOMAIN_REGEX.test(extractedDomain)) {
          throw new EnrichmentError(`Invalid domain format extracted: ${extractedDomain}`, "INVALID_DOMAIN_FORMAT");
        }

        console.log("Successfully extracted domain:", extractedDomain);
        return extractedDomain;
      } catch (error) {
        console.error("Error in domainExtractTool:", error);
        
        if (error instanceof ValidationError || error instanceof EnrichmentError) {
          return `Error extracting domain: ${error.message}`;
        }

        return `Error extracting domain: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
    {
      name: "domain_extract",
      description: "Extract the official website domain from search results",
      schema: z.object({
        results: z
          .array(
            z.object({
              title: z.string().min(1, "Title cannot be empty"),
              url: z.string().url("URL must be a valid URL"),
              content: z.string().min(1, "Content cannot be empty"),
            })
          )
          .min(1, "At least one search result is required")
          .describe("The search results to extract the domain from"),
      }),
    }
  );
