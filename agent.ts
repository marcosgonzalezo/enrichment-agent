import * as dotenv from "dotenv";
dotenv.config();

import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { StateGraph, END, START } from "@langchain/langgraph";
import { enrichCompanyTool, enrichPersonTool } from "./tools";

export interface Lead {
  name: string;
  role: string;
  email: string;
  linkedin: string;
}

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

// Build the company enrichment agent
async function buildCompanyEnrichmentAgent() {
  // Create tools
  const searchTool = new TavilySearch({ maxResults: 4 });
  const enrichCompany = enrichCompanyTool();
  const model = new ChatOpenAI({ temperature: 0 });

  // Define state handlers
  // Process the initial query to extract company name
  async function processQuery(state: any): Promise<any> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage.content && typeof lastMessage.content === "string") {
      // Extract company name using LLM
      const response = await model.invoke([
        new HumanMessage(`Extract just the company domain from this query: "${lastMessage.content}"
        Only return the domain without any explanation or additional text.`),
      ]);

      const domain = response.content.toString().trim();

      return {
        companyDomain: domain,
        currentStep: "enrich",
      };
    }

    return {
      error: "Could not extract company name",
      currentStep: "end",
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

    const companyDataRaw = await enrichCompany.invoke({
      domain: state.companyDomain,
    });
    let companyData;

    try {
      companyData = JSON.parse(companyDataRaw);
    } catch (e) {
      companyData = { error: "Failed to parse company data" };
    }

    return {
      companyInfo: companyData,
      currentStep: "search_managers",
    };
  }

  // // Search for CTO information
  // async function searchCTOLead(state: any): Promise<any> {
  //   if (!state.companyInfo.name) {
  //     return {
  //       error: "No company name provided",
  //       currentStep: "end",
  //     };
  //   }

  //   const searchQuery = `cto ${state.companyInfo.name} site:linkedin.com`;
  //   const { results } = await searchTool.invoke({ query: searchQuery });
  //   console.log("RESULTS FOR CTO", results);

  //   return {
  //     messages: [
  //       ...state.messages,
  //       new AIMessage(`Searched for ${state.companyName}`),
  //     ],
  //     currentStep: "search_managers",
  //   };
  // }

  // Search for manager leads
  async function searchManagerLeads(state: any): Promise<any> {
    if (!state.companyInfo.name) {
      return {
        error: "No company name provided",
        currentStep: "end",
      };
    }

    const searchQuery = `senior engineering manager OR head of engineering ${state.companyInfo.name} site:linkedin.com`;
    const { results } = await searchTool.invoke({ query: searchQuery });
    console.log("search RESULTS FOR MANAGERS", results);

    const llmResponse = await model.invoke([
      new HumanMessage(`
        Extract an array of objects with the following structure
        For example:
        [{
          name: "",
          linkedin_url: "",
        }]
          Use this example as the format, the data should come from the list of results
        ###
        List to use:
        ${results}
        `),
    ]);

    // Parse the response into a properly typed array
    try {
      // Now you can use the parsed leads
      return {
        messages: [...state.messages],
        leads: llmResponse.content,
        currentStep: "summarize",
      };
    } catch (error) {
      console.error("Failed to parse leads:", error);
      return {
        error: "Failed to parse leads data",
        currentStep: "end",
      };
    }
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
    leads: Annotation<Lead[]>({
      default: () => [],
      reducer: (left: Lead[], right: Lead | Lead[]) => {
        if (Array.isArray(right)) {
          return [...left, ...right];
        }
        return [...left, right];
      },
    }),
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

  return (
    workflow
      .addNode("process_query", processQuery)
      .addNode("enrich", enrichCompanyData)
      // .addNode("search_cto", searchCTOLead)
      .addNode("search_managers", searchManagerLeads)
      .addNode("summarize", summarizeFindings)
      .addEdge(START, "process_query")
      .addEdge("process_query", "enrich")
      .addEdge("enrich", "search_managers")
      .addEdge("search_managers", "summarize")
      .addEdge("summarize", END)
      .compile()
  );
}

// Main function to run the agent
async function processCompany(companyQuery: string) {
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
    companyDomain: result.companyDomain,
    companyData: result.companyInfo,
    leads: result.leads,
  };
}

// Export for use in API server
export { processCompany };

// Example usage when running directly
if (require.main === module) {
  // You can test the agent directly by calling this function
  const testCompany = async () => {
    const result = await processCompany("Leads for c2fo.com");
    console.log(JSON.stringify(result, null, 2));
  };

  testCompany().catch(console.error);
}
