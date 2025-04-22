import axios from "axios";
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const enrichCompanyTool = () =>
  tool(
    async ({ domain }: { domain: string }) => {
      try {
        const url = "https://api.apollo.io/v1/organizations/enrich";
        const response = await axios.get(url, {
          params: { domain },
          headers: {
            "x-api-key": process.env.APOLLO_API_KEY,
          },
        });

        if (response.data.organization) {
          return JSON.stringify(response.data.organization);
        }
        return JSON.stringify({ error: "Company not found" });
      } catch (error) {
        return JSON.stringify({ error: `Apollo API error: ${error}` });
      }
    },
    {
      name: "apollo_company_info",
      description: "Gets company information from Apollo.io API",
      schema: z.object({
        domain: z
          .string()
          .describe("The domain name of the company to look up"),
      }),
    }
  );
