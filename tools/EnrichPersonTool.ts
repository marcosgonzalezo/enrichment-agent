import axios from "axios";
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const enrichPersonTool = () =>
  tool(
    async ({ name, company }: { name: string; company: string }) => {
      try {
        const url = "https://api.apollo.io/api/v1/people/match";
        const response = await axios.post(url, {
          data: {
            name: name,
            organization_name: company,
          },
          headers: {
            "x-api-key": process.env.APOLLO_API_KEY,
          },
        });

        if (response.data.organization) {
          return JSON.stringify(response.data.organization);
        }
        return JSON.stringify({ error: "Person not found" });
      } catch (error) {
        return JSON.stringify({ error: `Apollo API error: ${error}` });
      }
    },
    {
      name: "apollo_person_info",
      description: "Gets person information from Apollo.io API",
      schema: z.object({
        name: z.string().describe("the name of the person to look up"),
        company: z
          .string()
          .describe("the company name of the person to look up"),
      }),
    }
  );
