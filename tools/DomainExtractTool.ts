import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

export const domainExtractTool = (model: ChatOpenAI) =>
  tool(
    async ({ results }) => {
      try {
        const response = await model.invoke([
          new HumanMessage(
            `Extract the official website domain (just the domain, like "example.com") for the company from these search results. Only return the domain without any explanation or additional text.
            Avoid using the result that may come from linkedin or crunchbase, use the official website result.
            Search results:
            ${JSON.stringify(results)}`
          ),
        ]);

        console.log("extracting", response.content);

        return response.content;
      } catch (error) {
        return `Error extracting domain: ${error}`;
      }
    },
    {
      name: "domain_extract",
      description: "Call to surf the web.",
      schema: z.object({
        results: z
          .array(
            z.object({
              title: z.string(),
              url: z.string(),
              content: z.string(),
            })
          )
          .describe("The search results to extract the domain from"),
      }),
    }
  );
