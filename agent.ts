import * as dotenv from "dotenv";
dotenv.config();

import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { tool, Tool } from "@langchain/core/tools";
import { StateGraph, END, START } from "@langchain/langgraph";
import axios from "axios";
import { z } from "zod";
// Verify required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not found in environment variables");
  process.exit(1);
}

if (!process.env.TAVILY_API_KEY) {
  console.error("TAVILY_API_KEY not found in environment variables");
  process.exit(1);
}

if (!process.env.APOLLO_API_KEY) {
  console.error("APOLLO_API_KEY not found in environment variables");
  process.exit(1);
}

// Define a tool to get company info from Apollo
class ApolloCompanyTool extends Tool {
  name = "apollo_company_info";
  description = "Gets company information from Apollo.io API";

  constructor() {
    super();
  }

  async _call(domain: string): Promise<string> {
    try {
      const url = "https://api.apollo.io/v1/organizations/enrich";
      const response = await axios.get(url, {
        params: {
          domain: domain,
        },
        headers: {
          "x-api-key": process.env.APOLLO_API_KEY,
        },
      });

      if (response.data.organization) {
        return JSON.stringify(response.data.organization);
      } else {
        return JSON.stringify({ error: "Company not found" });
      }
    } catch (error) {
      return JSON.stringify({ error: `Apollo API error: ${error}` });
    }
  }
}

// Build the company enrichment agent
async function buildCompanyEnrichmentAgent() {
  // Create tools
  const searchTool = new TavilySearch({ maxResults: 4 });
  const apolloTool = new ApolloCompanyTool();
  const model = new ChatOpenAI({ temperature: 0 });

  const domainExtract = tool(
    async ({ results }) => {
      try {
        // The input will be the search results
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

  // Define state handlers

  // Process the initial query to extract company name
  async function processQuery(state: any): Promise<any> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage.content && typeof lastMessage.content === "string") {
      // Extract company name using LLM
      const response = await model.invoke([
        new HumanMessage(`Extract just the company name from this query: "${lastMessage.content}"
        Only return the company name without any explanation or additional text.`),
      ]);

      const companyName = response.content.toString().trim();

      return {
        companyName,
        currentStep: "search",
      };
    }

    return {
      error: "Could not extract company name",
      currentStep: "end",
    };
  }

  // Search for company information
  async function searchCompany(state: any): Promise<any> {
    if (!state.companyName) {
      return {
        error: "No company name provided",
        currentStep: "end",
      };
    }

    const searchQuery = `${state.companyName} official website`;
    const { results } = await searchTool.invoke({ query: searchQuery });

    return {
      messages: [
        ...state.messages,
        new AIMessage(`Searched for ${state.companyName}`),
      ],
      currentStep: "extract_domain",
      companyName: state.companyName,
      companyInfo: { results },
    };
  }

  // Extract domain from search results
  async function extractDomain(state: any): Promise<any> {
    if (!state.companyInfo?.results) {
      return {
        error: "No search results available",
        currentStep: "end",
      };
    }

    const domain = await domainExtract.invoke({
      results: state.companyInfo.results,
    });

    return {
      companyDomain: domain,
      currentStep: "enrich",
    };
  }

  // Enrich company data with Apollo
  async function enrichCompanyData(state: any): Promise<any> {
    if (!state.companyDomain) {
      return {
        error: "No company domain available",
        currentStep: "end",
      };
    }

    const companyDataRaw = await apolloTool.invoke(state.companyDomain);
    let companyData;

    try {
      companyData = JSON.parse(companyDataRaw);
    } catch (e) {
      companyData = { error: "Failed to parse company data" };
    }

    return {
      companyInfo: companyData,
      currentStep: "summarize",
    };
  }

  // Summarize the findings
  async function summarizeFindings(state: any): Promise<any> {
    const companyInfo = state.companyInfo;
    const companyName = state.companyName;
    const companyDomain = state.companyDomain;

    let summaryPrompt = `Create a comprehensive summary of ${companyName} (domain: ${companyDomain}) based on this information:
    
    ${JSON.stringify(companyInfo, null, 2)}
    
    Include information about:
    - Industry and category
    - Company size and employee count
    - Location and headquarters
    - Funding information if available
    - Annual revenue if available
    - Brief description of what they do
    
    Format the response in a clean, readable way.`;

    const summary = await model.invoke([new HumanMessage(summaryPrompt)]);

    return {
      messages: [...state.messages, summary],
      currentStep: "end",
    };
  }

  // Create the graph

  const StateAnnotation = Annotation.Root({
    companyName: Annotation<string>,
    companyDomain: Annotation<string>,
    companyInfo: Annotation<string>,
    currentStep: Annotation<string>,
    error: Annotation<string>,
    messages: Annotation<BaseMessage[]>({
      reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
        if (Array.isArray(right)) {
          return left.concat(right);
        }
        return left.concat([right]);
      },
      default: () => [],
    }),
  });
  const workflow = new StateGraph(StateAnnotation);

  return workflow
    .addNode("process_query", processQuery)
    .addNode("search", searchCompany)
    .addNode("extract_domain", extractDomain)
    .addNode("enrich", enrichCompanyData)
    .addNode("summarize", summarizeFindings)
    .addEdge(START, "process_query")
    .addEdge("process_query", "search")
    .addEdge("search", "extract_domain")
    .addEdge("extract_domain", "enrich")
    .addEdge("enrich", "summarize")
    .addEdge("summarize", END)
    .compile();
}

// Main function to run the agent
async function processCompany(companyQuery: string) {
  console.log(companyQuery);

  const agent = await buildCompanyEnrichmentAgent();

  const initialState = {
    messages: [new HumanMessage(companyQuery)],
    currentStep: "process_query",
  };

  const result = await agent.invoke(initialState);

  if (result.error) {
    return {
      success: false,
      error: result.error,
      message: "Failed to process company information",
    };
  }

  // Return the final message (the summary) and the structured data
  return {
    success: true,
    summary: result.messages[result.messages.length - 1].content,
    companyName: result.companyName,
    companyDomain: result.companyDomain,
    companyData: result.companyInfo,
  };
}

// Export for use in API server
export { processCompany };

// Example usage when running directly
if (require.main === module) {
  // You can test the agent directly by calling this function
  const testCompany = async () => {
    const result = await processCompany("Tell me about Develative");
    console.log(JSON.stringify(result, null, 2));
  };

  testCompany().catch(console.error);
}
